import { bytesToHex } from "@noble/hashes/utils.js";
import { equalHex, p2pkhAddress, recoverPublicKey } from "../auth/bitcoin.ts";
import { takeChallenge } from "../auth/challenge.ts";
import type { Db } from "../db.ts";
import type { TwetchUser } from "../types.ts";
import { cacheTwetchProfile } from "./cache.ts";
import { TwetchAuthError, type TwetchChallenge, type TwetchClient } from "./types.ts";

export function parseStoredChallenge(raw: string): TwetchChallenge {
  try {
    const parsed = JSON.parse(raw) as TwetchChallenge;
    if (parsed && typeof parsed === "object" && typeof parsed.message === "string") {
      return parsed;
    }
  } catch {
    // Stored as a bare challenge string.
  }
  return { message: raw };
}

export async function completeTwetchWalletLogin(
  db: Db,
  twetch: TwetchClient,
  input: { challengeId: string; address: string; signature: string; algorithm?: string },
): Promise<TwetchUser> {
  const raw = await takeChallenge(db, input.challengeId);
  if (!raw) {
    throw new TwetchAuthError("Challenge expired. Request a new one.", 400);
  }
  const challenge = parseStoredChallenge(raw);
  const token = await twetch.authenticate({
    message: challenge.message,
    nonce: challenge.nonce,
    ts: challenge.ts,
    signature: input.signature,
    address: input.address,
    algorithm: input.algorithm,
  });
  const profile = await twetch.me(token);
  return cacheTwetchProfile(db, profile, { signingAddress: input.address });
}

export async function completeTwetchTokenLogin(
  db: Db,
  twetch: TwetchClient,
  token: string,
): Promise<TwetchUser> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new TwetchAuthError("A Twetch session token is required.", 400);
  }
  const profile = await twetch.me(trimmed);
  return cacheTwetchProfile(db, profile);
}

export async function completeTwetchSeedLogin(
  db: Db,
  twetch: TwetchClient,
  input: { challengeId: string; signature: string; publicKey?: string },
): Promise<TwetchUser> {
  if (looksLikeMnemonic(input.signature) || looksLikeMnemonic(input.publicKey)) {
    throw new TwetchAuthError("Do not send a seed phrase to the server.", 400);
  }
  const raw = await takeChallenge(db, input.challengeId);
  if (!raw) {
    throw new TwetchAuthError("Challenge expired. Request a new one.", 400);
  }
  const challenge = parseStoredChallenge(raw);
  let recovered: Uint8Array;
  try {
    recovered = recoverPublicKey(challenge.message, input.signature);
  } catch {
    throw new TwetchAuthError("Signature did not match this challenge.", 401);
  }
  const publicKeyHex = bytesToHex(recovered);
  if (input.publicKey && !equalHex(publicKeyHex, input.publicKey)) {
    throw new TwetchAuthError("Signature did not match this challenge.", 401);
  }
  const profile = await twetch.userByPubkey(publicKeyHex);
  if (!profile) {
    throw new TwetchAuthError(
      "Twetch has no identity key for this seed. Use the 12-word backup from twetch.com, not a Yours or Electrum phrase. Older accounts that never published a publicKey cannot sign in this way.",
      401,
    );
  }
  return cacheTwetchProfile(db, profile, { signingAddress: p2pkhAddress(recovered) });
}

function looksLikeMnemonic(value?: string): boolean {
  if (!value) return false;
  const words = value.trim().toLowerCase().split(/\s+/);
  return words.length >= 12 && words.every((word) => /^[a-z]+$/.test(word));
}

export function readSubmittedToken(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  return String(record.token ?? record.access_token ?? "").trim();
}
