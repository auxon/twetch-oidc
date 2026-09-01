import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { loadConfig } from "../src/config.ts";
import { openDb, upsertClient, type Db } from "../src/db.ts";
import { seed } from "../src/seed.ts";
import { createApp } from "../src/app.ts";
import type { TwetchClient, TwetchProfile } from "../src/twetch/types.ts";
import { TwetchAuthError } from "../src/twetch/types.ts";

export class CookieJar {
  private cookies = new Map<string, string>();
  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  eat(res: Response) {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const pair = raw.split(";", 1)[0];
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (raw.toLowerCase().includes("max-age=0") || value === "") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }
}

export async function getPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
    server.on("error", reject);
  });
}

export interface TestIdp {
  issuer: string;
  port: number;
  db: Db;
  server: Server;
  jar: CookieJar;
}

export async function startIdp(): Promise<TestIdp> {
  const port = await getPort();
  const issuer = `http://127.0.0.1:${port}`;
  const db = openDb(":memory:");
  await seed(db);
  upsertClient(db, {
    clientId: "test-client",
    clientSecret: "test-secret",
    ownerId: "1",    clientName: "Test App",
    clientUri: "http://rp.example",
    logoUri: "http://rp.example/logo.png",
    redirectUris: ["http://rp.example/callback"],
    postLogoutRedirectUris: ["http://rp.example/"],
    tokenEndpointAuthMethod: "client_secret_post",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    scope: "openid profile email offline_access",
    disabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const config = loadConfig({
    issuer,
    port,
    databasePath: ":memory:",
    demoMode: opts.demoMode ?? !live,
    live,
  });
  const { app } = await createApp(db, config, { twetch: opts.twetch });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
  });  return { issuer, port, db, server, jar: new CookieJar() };
}

export async function stopIdp(idp: TestIdp) {
  await new Promise<void>((resolve, reject) => {
    idp.server.close((err) => (err ? reject(err) : resolve()));
  });
  idp.db.close();
}

export async function request(
  idp: TestIdp,
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${idp.issuer}${pathOrUrl}`;
  const headers = new Headers(init.headers);
  const cookie = idp.jar.header();
  if (cookie) headers.set("cookie", cookie);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  idp.jar.eat(res);
  return res;
}

export async function follow(idp: TestIdp, pathOrUrl: string, limit = 12): Promise<{
  res: Response;
  body: string;
  url: string;
  external?: URL;
}> {
  let next = pathOrUrl.startsWith("http") ? pathOrUrl : `${idp.issuer}${pathOrUrl}`;
  let res = await request(idp, next);
  for (let i = 0; i < limit; i++) {
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      const dest = new URL(location, next);
      if (dest.origin !== new URL(idp.issuer).origin) {
        return { res, body: "", url: next, external: dest };
      }
      next = dest.href;
      res = await request(idp, next);
      continue;
    }
    return { res, body: await res.text(), url: next };
  }
  return { res, body: await res.text(), url: next };
}

export function formBody(data: Record<string, string>): URLSearchParams {  return new URLSearchParams(data);
}