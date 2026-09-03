import type { Db } from "../db.ts";
import { getUserById } from "../db.ts";
import { cacheTwetchProfile } from "../twetch/cache.ts";
import type { TwetchClient } from "../twetch/types.ts";
import type { TwetchClaims } from "../types.ts";

const PROFILE_URL = "https://twetch.com/u";

export function createFindAccount(db: Db, twetch?: TwetchClient) {
  return async function findAccount(_ctx: unknown, id: string) {
    let user = await getUserById(db, id);
    if (!user && twetch) {
      const profile = await twetch.userById(id);
      if (profile) {
        user = await cacheTwetchProfile(db, profile);
      }
    }
    if (!user) return undefined;

    return {
      accountId: user.id,
      async claims(): Promise<TwetchClaims> {
        const claims: TwetchClaims = { sub: user.id };
        claims.name = user.displayName;
        claims.preferred_username = user.handle;
        if (user.avatarUrl) claims.picture = user.avatarUrl;
        claims.profile = `${PROFILE_URL}/${user.id}`;
        claims.updated_at = Math.floor(user.updatedAt / 1000);
        if (user.email) {
          claims.email = user.email;
          claims.email_verified = user.emailVerified;
        }
        if (user.signingPubkey) {
          claims.twetch_pubkey = user.signingPubkey;
        }
        return claims;
      },
    };
  };
}
