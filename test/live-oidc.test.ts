import { afterEach, describe, expect, it } from "vitest";
import {
  createFakeTwetchClient,
  follow,
  formBody,
  LIVE_TWETCH_PROFILE,
  request,
  startIdp,
  stopIdp,
  type TestIdp,
} from "./helpers.ts";
import { createFindAccount } from "../src/oidc/account.ts";
import { getUserById } from "../src/db.ts";
import { demoWallet } from "../src/seed.ts";
import { signMessage } from "../src/auth/bitcoin.ts";
import { deriveTwetchAccount } from "../src/auth/twetch-seed.ts";
import * as client from "openid-client";

let idp: TestIdp | undefined;

afterEach(async () => {
  if (idp) {
    await stopIdp(idp);
    idp = undefined;
  }
});

async function beginLogin(current: TestIdp) {
  const oidc = await client.discovery(
    new URL(current.issuer),
    "test-client",
    "test-secret",
    undefined,
    { execute: [client.allowInsecureRequests] },
  );
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const authorize = client.buildAuthorizationUrl(oidc, {
    redirect_uri: "http://rp.example/callback",
    scope: "openid profile email",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  const loginPage = await follow(current, authorize.href);
  expect(loginPage.res.status).toBe(200);
  expect(loginPage.body).toContain("production Twetch");
  expect(loginPage.body).toContain("seed phrase");
  expect(loginPage.body).not.toContain("Unisat");
  expect(loginPage.body).not.toContain("name=\"password\"");
  const uid = new URL(loginPage.url).pathname.split("/")[2];
  return { oidc, verifier, state, nonce, uid };
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
  const continued = await follow(
    current,
    afterConfirm.headers.get("location") ?? `/interaction/${uid}`,
  );
  expect(continued.external).toBeTruthy();
  return client.authorizationCodeGrant(session.oidc, continued.external!, {
    pkceCodeVerifier: session.verifier,
    expectedState: session.state,
    expectedNonce: session.nonce,
  });
}

describe("live Twetch OIDC", () => {
  it("fetches the challenge from Twetch and issues tokens for me.id", async () => {
    const twetch = createFakeTwetchClient();
    idp = await startIdp({ live: true, twetch });
    const session = await beginLogin(idp);
    const challengeRes = await request(idp, `/interaction/${session.uid}/challenge`);
    const challenge = (await challengeRes.json()) as { id: string; message: string; source: string };
    expect(challenge.source).toBe("twetch");
    expect(challenge.message).toBe(twetch.challenges[0]);

    const wallet = demoWallet();
    const signature = signMessage(challenge.message, wallet.secretKey);
    const posted = await request(idp, `/interaction/${session.uid}/wallet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.id,
        address: wallet.address,
        signature,
        algorithm: "BTC_BIP322",
      }),
    });
    expect(posted.status).toBeGreaterThanOrEqual(300);
    expect(twetch.tokens).toHaveLength(1);

    const consent = await follow(idp, posted.headers.get("location")!);
    const tokens = await confirmAndExchange(idp, session, consent);
    const claims = tokens.claims()!;
    expect(claims.sub).toBe(LIVE_TWETCH_PROFILE.id);
    expect(claims.preferred_username).toBe("liveuser");
    expect(claims.name).toBe("Live User");
    expect(claims.twetch_pubkey).toBe(LIVE_TWETCH_PROFILE.publicKey);
    expect((await getUserById(idp.db, "4242"))?.signingAddress).toBe(wallet.address);
  });

  it("rejects pasted session tokens because Twetch no longer issues them", async () => {
    const twetch = createFakeTwetchClient();
    idp = await startIdp({ live: true, twetch });
    const session = await beginLogin(idp);
    const posted = await request(idp, `/interaction/${session.uid}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "pasted-token" }),
    });
    expect(posted.status).toBe(410);
  });

  it("rejects password login against production Twetch", async () => {
    idp = await startIdp({ live: true, twetch: createFakeTwetchClient() });
    const session = await beginLogin(idp);
    const posted = await request(idp, `/interaction/${session.uid}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ identifier: "josh@twetch.example", password: "twetch-demo" }),
    });
    expect(posted.status).toBe(400);
    const body = await posted.text();
    expect(body).toMatch(/password login is disabled/i);
  });

  it("signs the developer console in with a live Twetch wallet", async () => {
    const twetch = createFakeTwetchClient();
    idp = await startIdp({ live: true, twetch });
    const challengeRes = await request(idp, "/login/challenge");
    const challenge = (await challengeRes.json()) as { id: string; message: string };
    const wallet = demoWallet();
    const signature = signMessage(challenge.message, wallet.secretKey);
    const login = await request(idp, "/login/wallet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.id,
        address: wallet.address,
        signature,
        next: "/console",
      }),
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { ok: boolean; sub: string; redirect: string };
    expect(body.ok).toBe(true);
    expect(body.sub).toBe("4242");
    expect(body.redirect).toBe("/console");

    const consolePage = await follow(idp, "/console");
    expect(consolePage.res.status).toBe(200);
    expect(consolePage.body).toContain("Developer console");
  });

  it("signs in with a Twetch seed without sending the mnemonic", async () => {
    const derived = deriveTwetchAccount(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );
    const twetch = createFakeTwetchClient({ publicKey: derived.publicKeyHex });
    idp = await startIdp({ live: true, twetch });
    const session = await beginLogin(idp);
    const refused = await request(idp, `/interaction/${session.uid}/seed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        signature: "x",
        challengeId: "nope",
      }),
    });
    expect(refused.status).toBe(400);

    const challengeRes = await request(idp, `/interaction/${session.uid}/seed-challenge`);
    const challenge = (await challengeRes.json()) as { id: string; message: string; source: string };
    expect(challenge.source).toBe("local");
    const signature = signMessage(challenge.message, derived.secretKey);
    const posted = await request(idp, `/interaction/${session.uid}/seed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.id,
        signature,
        publicKey: derived.publicKeyHex,
      }),
    });
    expect(posted.status).toBe(200);
    const postedBody = (await posted.json()) as { ok: boolean; redirect: string; sub: string };
    expect(postedBody.ok).toBe(true);
    expect(typeof postedBody.redirect).toBe("string");
    const consent = await follow(idp, postedBody.redirect);
    const tokens = await confirmAndExchange(idp, session, consent);
    expect(tokens.claims()?.sub).toBe("4242");
  });

  it("hydrates OIDC claims from Twetch userById when the cache is cold", async () => {
    const twetch = createFakeTwetchClient();
    idp = await startIdp({ live: true, twetch });
    const findAccount = createFindAccount(idp.db, twetch);
    const account = await findAccount(undefined, "4242");
    expect(account).toBeTruthy();
    const claims = await account!.claims();
    expect(claims.sub).toBe("4242");
    expect(claims.preferred_username).toBe("liveuser");
    expect((await getUserById(idp.db, "4242"))?.displayName).toBe("Live User");
  });
});