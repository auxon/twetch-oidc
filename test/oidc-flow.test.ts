import { afterEach, describe, expect, it } from "vitest";
import * as client from "openid-client";
import { decodeJwt } from "jose";
import { follow, formBody, request, startIdp, stopIdp, type TestIdp } from "./helpers.ts";
import { createFindAccount } from "../src/oidc/account.ts";
import { demoWallet } from "../src/seed.ts";
import { signMessage } from "../src/auth/bitcoin.ts";
import Twetch from "../packages/authjs-twetch/index.js";

let idp: TestIdp | undefined;

afterEach(async () => {
  if (idp) {
    await stopIdp(idp);
    idp = undefined;
  }
});

async function beginLogin(current: TestIdp, scope = "openid profile email") {
  const oidc = await client.discovery(
    new URL(current.issuer),
    "test-client",
    "test-secret",
    undefined,
    { execute: [client.allowInsecureRequests] },
  );
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();  const nonce = client.randomNonce();
  const authorize = client.buildAuthorizationUrl(oidc, {
    redirect_uri: "http://rp.example/callback",
    scope,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  const loginPage = await follow(current, authorize.href);
  expect(loginPage.res.status).toBe(200);
  expect(loginPage.body).toContain("Sign in with Twetch");
  const uid = new URL(loginPage.url).pathname.split("/")[2];
  return { oidc, verifier, state, nonce, uid, loginPage };
}

async function loginPassword(current: TestIdp, session: Awaited<ReturnType<typeof beginLogin>>) {
  const posted = await request(current, `/interaction/${session.uid}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody({ identifier: "josh@twetch.example", password: "twetch-demo" }),
  });
  expect(posted.status).toBeGreaterThanOrEqual(300);
  return follow(current, posted.headers.get("location")!);
}

async function confirmAndExchange(
  current: TestIdp,
  session: Awaited<ReturnType<typeof beginLogin>>,
  consentPage: Awaited<ReturnType<typeof follow>>,
) {
  expect(consentPage.body).toContain("Allow");
  const uid = new URL(consentPage.url).pathname.split("/")[2];
  const afterConfirm = await request(current, `/interaction/${uid}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody({}),
  });
  const continued = await follow(current, afterConfirm.headers.get("location") ?? `/interaction/${uid}`);
  expect(continued.external).toBeTruthy();
  const callback = continued.external!;
  expect(callback.searchParams.get("state")).toBe(session.state);
  const tokens = await client.authorizationCodeGrant(session.oidc, callback, {
    pkceCodeVerifier: session.verifier,
    expectedState: session.state,
    expectedNonce: session.nonce,
  });
  return tokens;
}

describe("OIDC provider", () => {
  it("publishes discovery, JWKS, and revocation", async () => {
    idp = await startIdp();
    const discovery = (await (
      await request(idp, "/.well-known/openid-configuration")
    ).json()) as {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      userinfo_endpoint: string;
      jwks_uri: string;
      revocation_endpoint: string;
      end_session_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    expect(discovery.issuer).toBe(idp.issuer);
    expect(discovery.authorization_endpoint).toBe(`${idp.issuer}/authorize`);
    expect(discovery.token_endpoint).toBe(`${idp.issuer}/token`);    expect(discovery.jwks_uri).toBe(`${idp.issuer}/jwks`);
    expect(discovery.revocation_endpoint).toBe(`${idp.issuer}/revoke`);
    expect(discovery.end_session_endpoint).toBe(`${idp.issuer}/logout`);
    expect(discovery.code_challenge_methods_supported).toContain("S256");

    const jwks = (await (await request(idp, "/jwks")).json()) as {
      keys: Array<{ kty: string; d?: string }>;
    };
    expect(jwks.keys.length).toBeGreaterThan(0);
    expect(jwks.keys[0].kty).toBe("EC");
    expect(jwks.keys[0].d).toBeUndefined();  });

  it("completes authorization code + PKCE with password login", async () => {
    idp = await startIdp();
    const session = await beginLogin(idp);
    const consent = await loginPassword(idp, session);
    const tokens = await confirmAndExchange(idp, session, consent);
    const claims = tokens.claims()!;
    expect(claims.sub).toBe("1");
    expect(claims.preferred_username).toBe("josh");
    expect(claims.name).toBe("Josh Petty");
    expect(claims.email).toBe("josh@twetch.example");
    expect(claims.email_verified).toBe(true);

    const payload = decodeJwt(tokens.id_token!);
    expect(payload.sub).toBe("1");
    expect(payload.aud).toBe("test-client");

    const userinfo = await client.fetchUserInfo(session.oidc, tokens.access_token, claims.sub);
    expect(userinfo.sub).toBe("1");
    expect(userinfo.picture).toBeTruthy();
  });

  it("omits email for wallet-only users and keeps numeric sub", async () => {
    idp = await startIdp();
    const session = await beginLogin(idp);
    const posted = await request(idp, `/interaction/${session.uid}/demo-wallet`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({}),
    });
    const consent = await follow(idp, posted.headers.get("location")!);
    const tokens = await confirmAndExchange(idp, session, consent);
    const claims = tokens.claims()!;
    expect(claims.sub).toBe("2");
    expect(claims.preferred_username).toBe("nondualrandy");
    expect(claims.email).toBeUndefined();
    expect(claims.twetch_pubkey).toBe(demoWallet().publicKeyHex);
  });

  it("accepts a real Bitcoin signature for wallet login", async () => {
    idp = await startIdp();
    const session = await beginLogin(idp);
    const challengeRes = await request(idp, `/interaction/${session.uid}/challenge`);
    const challenge = (await challengeRes.json()) as { id: string; message: string };
    const wallet = demoWallet();
    const signature = signMessage(challenge.message, wallet.secretKey);
    const posted = await request(idp, `/interaction/${session.uid}/wallet`, {      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.id,
        address: wallet.address,
        signature,
      }),
    });
    expect(posted.status).toBeGreaterThanOrEqual(300);
    const consent = await follow(idp, posted.headers.get("location")!);
    const tokens = await confirmAndExchange(idp, session, consent);
    expect(tokens.claims()?.sub).toBe("2");
  });
  it("rejects authorize without PKCE", async () => {
    idp = await startIdp();
    const url = new URL("/authorize", idp.issuer);
    url.searchParams.set("client_id", "test-client");
    url.searchParams.set("redirect_uri", "http://rp.example/callback");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid");
    url.searchParams.set("state", "abc");
    const res = await follow(idp, url.href);
    expect(res.body + (res.external?.href ?? "")).toMatch(/pkce|code_challenge|invalid_request/i);
  });

  it("rejects an unregistered redirect_uri", async () => {
    idp = await startIdp();
    const url = new URL("/authorize", idp.issuer);
    url.searchParams.set("client_id", "test-client");
    url.searchParams.set("redirect_uri", "https://evil.example/cb");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid");
    url.searchParams.set("code_challenge", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    url.searchParams.set("code_challenge_method", "S256");
    const res = await follow(idp, url.href);
    expect(res.res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("claims model", () => {
  it("never fabricates email and uses Twetch user id as sub", async () => {
    idp = await startIdp();
    const findAccount = createFindAccount(idp.db);
    const withEmail = await (await findAccount(undefined, "1"))!.claims();
    expect(withEmail.sub).toBe("1");
    expect(withEmail.email).toBe("josh@twetch.example");

    const walletOnly = await (await findAccount(undefined, "2"))!.claims();
    expect(walletOnly.sub).toBe("2");
    expect(walletOnly.email).toBeUndefined();
    expect(walletOnly.email_verified).toBeUndefined();
    expect(walletOnly.preferred_username).toBe("nondualrandy");
    expect(walletOnly.twetch_pubkey).toBeTruthy();
  });
});

describe("developer console", () => {
  it("creates an OAuth client with redirect URIs", async () => {
    idp = await startIdp();
    const login = await request(idp, "/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({
        identifier: "josh",
        password: "twetch-demo",
        next: "/console",
      }),
    });
    expect(login.status).toBeGreaterThanOrEqual(300);
    await follow(idp, login.headers.get("location") || "/console");

    const created = await request(idp, "/console/apps", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_name: "Board",
        client_uri: "https://board.example",
        redirect_uris: "https://board.example/api/auth/callback/twetch",
      }),
    });
    expect(created.status).toBeGreaterThanOrEqual(300);
    const loc = new URL(created.headers.get("location")!, idp.issuer);
    expect(loc.searchParams.get("created")).toMatch(/^twetch_/);
    expect(loc.searchParams.get("secret")).toBeTruthy();
  });
});

describe("Auth.js provider", () => {
  it("exports an OIDC provider object", () => {
    const provider = Twetch({
      clientId: "abc",
      clientSecret: "def",
      issuer: "https://id.twetch.app",
    });
    expect(provider.id).toBe("twetch");
    expect(provider.type).toBe("oidc");
    expect(provider.issuer).toBe("https://id.twetch.app");
    expect(provider.authorization.params.scope).toBe("openid profile");
  });
});