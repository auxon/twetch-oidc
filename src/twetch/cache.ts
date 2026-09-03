import type { Db } from "../db.ts";
import { upsertUser } from "../db.ts";
import type { TwetchUser } from "../types.ts";
import type { TwetchProfile } from "./types.ts";

export async function cacheTwetchProfile(
  db: Db,
  profile: TwetchProfile,
  extras: { signingAddress?: string } = {},
): Promise<TwetchUser> {
  const now = Date.now();
  const user: TwetchUser = {
    id: profile.id,
    handle: profile.handle || `u${profile.id}`,
    displayName: profile.name,
    avatarUrl: profile.picture ?? null,
    email: profile.email ?? null,
    emailVerified: Boolean(profile.email),
    passwordHash: null,
    signingAddress: extras.signingAddress ?? null,
    signingPubkey: profile.publicKey ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await upsertUser(db, user);
  return user;
}
