import { EncryptJWT, jwtDecrypt } from "jose";
import type { Request, Response } from "express";
import type { TwetchUser } from "../types.ts";
import { getUserById, type Db } from "../db.ts";

const COOKIE = "twetch_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 14;

function secretKey(secret: string): Uint8Array {
  const encoded = new TextEncoder().encode(secret);
  if (encoded.length >= 32) return encoded.slice(0, 32);
  const padded = new Uint8Array(32);
  padded.set(encoded);
  return padded;
}

export async function setUserSession(res: Response, user: TwetchUser, sessionSecret: string) {
  const token = await new EncryptJWT({ sub: user.id })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .encrypt(secretKey(sessionSecret));

  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SEC * 1000,
    path: "/",
  });
}

export function clearUserSession(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

export async function readSessionUserId(req: Request, sessionSecret: string): Promise<string | undefined> {
  const token = req.cookies?.[COOKIE];
  if (!token) return undefined;
  try {
    const { payload } = await jwtDecrypt(token, secretKey(sessionSecret));
    return typeof payload.sub === "string" ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

export async function readSessionUser(
  req: Request,
  db: Db,
  sessionSecret: string,
): Promise<TwetchUser | undefined> {
  const id = await readSessionUserId(req, sessionSecret);
  if (!id) return undefined;
  return getUserById(db, id);
}

export const SESSION_COOKIE = COOKIE;
