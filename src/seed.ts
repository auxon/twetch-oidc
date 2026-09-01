import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";
import bcrypt from "bcryptjs";
import type { Db } from "./db.ts";
import { getSigningKeys, insertSigningKey, upsertClient, upsertUser } from "./db.ts";
import { walletFromSecretHex } from "./auth/bitcoin.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Deterministic demo wallet: sha256("twetch-demo-wallet"). */
export const DEMO_WALLET_SECRET_HEX = bytesToHex(sha256(new TextEncoder().encode("twetch-demo-wallet")));

export const DEMO_PASSWORD = "twetch-demo";

export function demoWallet() {
  return walletFromSecretHex(DEMO_WALLET_SECRET_HEX);
}

export interface SeedOptions {
  live?: boolean;
  seedExampleClient?: boolean;
}

export async function seed(db: Db, options: SeedOptions = {}) {
  const now = Date.now();
  const live = options.live ?? false;
  const seedExampleClient = options.seedExampleClient ?? true;

  if (!live) {
    const wallet = demoWallet();
    const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

    upsertUser(db, {
      id: "1",
      handle: "josh",
      displayName: "Josh Petty",
      avatarUrl: "https://api.dicebear.com/9.x/identicon/svg?seed=josh",
      email: "josh@twetch.example",
      emailVerified: true,
      passwordHash,
      signingAddress: null,
      signingPubkey: null,
      createdAt: now,
      updatedAt: now,
    });

    upsertUser(db, {
      id: "2",
      handle: "nondualrandy",
      displayName: "Billy Rose",
      avatarUrl: "https://api.dicebear.com/9.x/identicon/svg?seed=randy",
      email: null,
      emailVerified: false,
      passwordHash: null,
      signingAddress: wallet.address,
      signingPubkey: wallet.publicKeyHex,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (seedExampleClient) {
    upsertClient(db, {
      clientId: "twetch-example-rp",
      clientSecret: "twetch-example-secret",
      ownerId: live ? "system" : "1",
      clientName: "Example Relying Party",
      clientUri: "http://localhost:3001",
      logoUri: null,
      redirectUris: ["http://localhost:3001/callback"],
      postLogoutRedirectUris: ["http://localhost:3001"],
      tokenEndpointAuthMethod: "client_secret_post",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      scope: "openid profile email offline_access",
      disabled: false,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function loadOrCreateJwks(db: Db) {  const existing = getSigningKeys(db);
  if (existing.length > 0) {
    return { keys: existing };
  }

  const { privateKey } = await generateKeyPair("RS256", { extractable: true, modulusLength: 2048 });
  const jwk = await exportJWK(privateKey);
  const kid = await calculateJwkThumbprint(jwk);
  const stored = { ...jwk, kid, alg: "RS256", use: "sig" };
  insertSigningKey(db, kid, stored);
  return { keys: [stored] };
}