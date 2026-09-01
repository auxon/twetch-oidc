import { takeChallenge } from "../auth/challenge.ts";
import type { Db } from "../db.ts";
import type { TwetchUser } from "../types.ts";
import { cacheTwetchProfile } from "./cache.ts";
import { TwetchAuthError, type TwetchClient } from "./types.ts";

export async function completeTwetchWalletLogin(
  db: Db,
  twetch: TwetchClient,
  input: { challengeId: string; address: string; signature: string },
): Promise<TwetchUser> {
  const message = takeChallenge(db, input.challengeId);
  if (!message) {
    throw new TwetchAuthError("Challenge expired. Request a new one.", 400);
  }
  const token = await twetch.authenticate({
    message,
    signature: input.signature,
    address: input.address,
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

export function readSubmittedToken(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  return String(record.token ?? record.access_token ?? "").trim();
}