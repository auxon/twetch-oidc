import { describe, expect, it } from "vitest";
import { HttpTwetchClient, inferTwetchAlgorithm, mapProfile, summarizeTwetchError } from "../src/twetch/client.ts";
import { TwetchAuthError } from "../src/twetch/types.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpTwetchClient", () => {
  it("loads a challenge, authenticates, and reads the user profile", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const twetch = new HttpTwetchClient({
      authUrl: "https://api.twetch.com/",
      apiUrl: "https://api.twetch.com/",
      graphqlUrl: "https://api.twetch.com/",
      fetch: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        calls.push({ url, method, body });
        if (url.endsWith("/v1/auth/login-challenge")) {
          return jsonResponse(200, {
            challenge: "twetch-login:abc123:99",
            nonce: "abc123",
            ts: 99,
          });
        }
        if (url.endsWith("/v1/auth/login-external")) {
          expect(body).toMatchObject({
            algorithm: "BTC_BIP322",
            address: "bc1qexample",
            signature: "sig",
            nonce: "abc123",
            ts: 99,
          });
          expect(typeof body.devicePubkey).toBe("string");
          expect(body.devicePubkey).toMatch(/^0[23][0-9a-f]{64}$/);
          return jsonResponse(200, { userId: 99 });
        }
        if (url.endsWith("/v1/users/99")) {
          return jsonResponse(200, {
            id: 99,
            name: "Josh",
            icon: "https://img.example/j.png",
            publicKey: "02ff",
          });
        }
        if (url.includes("/v1/auth/user-by-pubkey/02ff")) {
          return jsonResponse(200, { userId: 99 });
        }
        return jsonResponse(404, { error: url });
      },
    });

    const challenge = await twetch.getChallenge();
    expect(challenge).toMatchObject({ message: "twetch-login:abc123:99", nonce: "abc123", ts: 99 });
    expect(await twetch.authenticate({ ...challenge, signature: "sig", address: "bc1qexample" })).toBe("99");
    const profile = await twetch.me("99");
    expect(profile).toMatchObject({
      id: "99",
      name: "Josh",
      handle: "Josh",
      picture: "https://img.example/j.png",
      publicKey: "02ff",
    });
    expect(await twetch.userByPubkey("02ff")).toMatchObject({ id: "99", name: "Josh" });
    expect(calls.some((call) => call.url === "https://api.twetch.com/v1/auth/login-challenge")).toBe(true);
  });

  it("surfaces Twetch HTTP errors without dumping HTML", async () => {
    const twetch = new HttpTwetchClient({
      authUrl: "https://api.twetch.com",
      apiUrl: "https://api.twetch.com",
      graphqlUrl: "https://api.twetch.com",
      fetch: async () =>
        new Response("<html><head><title>503 Service Temporarily Unavailable</title></head></html>", {
          status: 503,
          headers: { "content-type": "text/html" },
        }),
    });
    await expect(twetch.getChallenge()).rejects.toMatchObject({
      name: "TwetchAuthError",
      status: 503,
      message: expect.stringContaining("503 Service Temporarily Unavailable"),
    });
    await expect(twetch.getChallenge()).rejects.not.toMatchObject({
      message: expect.stringContaining("<html>"),
    });
  });

  it("wraps JSON error bodies", async () => {
    const twetch = new HttpTwetchClient({
      authUrl: "https://api.twetch.com",
      apiUrl: "https://api.twetch.com",
      graphqlUrl: "https://api.twetch.com",
      fetch: async () => jsonResponse(403, { error: "cloudflare" }),
    });
    await expect(twetch.getChallenge()).rejects.toBeInstanceOf(TwetchAuthError);
  });
});

describe("inferTwetchAlgorithm", () => {
  it("picks an algorithm from the address when none is given", () => {
    expect(inferTwetchAlgorithm("0x" + "a".repeat(40))).toBe("ETH_PERSONAL");
    expect(inferTwetchAlgorithm("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe("BTC_BIP322");
    expect(inferTwetchAlgorithm("So11111111111111111111111111111111111111112")).toBe("SOLANA_ED25519");
  });
});

describe("summarizeTwetchError", () => {
  it("extracts nginx titles from HTML", () => {
    expect(summarizeTwetchError("<html><head><title>503 Service Temporarily Unavailable</title></head></html>")).toBe(
      "503 Service Temporarily Unavailable",
    );
  });
});

describe("mapProfile", () => {
  it("never invents email and uses Twetch id as the stable handle fallback", () => {
    const profile = mapProfile({ id: 7, name: "Randy" });
    expect(profile.id).toBe("7");
    expect(profile.email).toBeUndefined();
    expect(profile.handle).toBe("Randy");
  });
});
