import { nanoid } from "nanoid";
import type { Db } from "../db.ts";
import { consumeChallenge, saveChallenge } from "../db.ts";

const TTL_MS = 5 * 60 * 1000;

export function createChallenge(db: Db, issuer: string): { id: string; message: string } {
  const nonce = nanoid(32);
  const issuedAt = new Date().toISOString();
  const message = [
    `${issuer} wants you to sign in with your Bitcoin identity.`,
    `URI: ${issuer}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
  return storeChallenge(db, message);
}

export function storeChallenge(db: Db, message: string): { id: string; message: string } {
  const id = nanoid(24);
  saveChallenge(db, id, message, Date.now() + TTL_MS);
  return { id, message };
}
export function takeChallenge(db: Db, id: string): string | undefined {
  return consumeChallenge(db, id);
}