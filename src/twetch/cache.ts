import type { Db } from "../db.ts";
import { upsertUser } from "../db.ts";
import type { TwetchUser } from "../types.ts";
import type { TwetchProfile } from "./types.ts";

export function cacheTwetchProfile(db: Db, profile: TwetchProfile): TwetchUser {
  const now = Date.now();
  const user: TwetchUser = {
    id: profile.id,
    handle: profile.handle || `u${profile.id}`,
    displayName: profile.name,
    avatarUrl: profile.picture ?? null,
    email: profile.email ?? null,
    emailVerified: Boolean(profile.email),
    passwordHash: null,
    signingAddress: null,
    signingPubkey: profile.publicKey ?? null,
    createdAt: now,
    updatedAt: now,
  };
  upsertUser(db, user);
  return user;
}