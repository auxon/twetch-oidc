import { describe, expect, it } from "vitest";
import { HttpTwetchClient, mapProfile } from "../src/twetch/client.ts";
import { TwetchAuthError } from "../src/twetch/types.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpTwetchClient", () => {
  it("loads a challenge, authenticates, and reads me from GraphQL", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const twetch = new HttpTwetchClient({
      authUrl: "https://auth.twetch.app/",
      apiUrl: "https://api.twetch.app/",
      graphqlUrl: "https://api.twetch.app/v1/graphql",
      fetch: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        calls.push({ url, method, body });
        if (url.endsWith("/api/v1/challenge")) {
          return jsonResponse(200, { message: "Sign this for Twetch" });
        }
        if (url.endsWith("/api/v1/me")) {
          return jsonResponse(404, { error: "missing" });
        }
        if (url.endsWith("/api/v1/authenticate")) {
          expect(body).toMatchObject({
            message: "Sign this for Twetch",
            signature: "sig",
            address: "1abc",
            v2: true,
          });
          return jsonResponse(200, { token: "prod-token" });
        }
        if (url.endsWith("/v1/graphql")) {
          expect(init?.headers && new Headers(init.headers).get("authorization")).toBe("Bearer prod-token");
          return jsonResponse(200, {
            data: {
              me: {
                id: 99,
                name: "Josh",
                icon: "https://img.example/j.png",
                publicKey: "02ff",
              },
            },
          });
        }
        return jsonResponse(404, { error: url });
      },
    });

    expect(await twetch.getChallenge()).toBe("Sign this for Twetch");
    expect(await twetch.authenticate({ message: "Sign this for Twetch", signature: "sig", address: "1abc" })).toBe(
      "prod-token",
    );
    const profile = await twetch.me("prod-token");
    expect(profile).toMatchObject({
      id: "99",
      name: "Josh",
      handle: "Josh",
      picture: "https://img.example/j.png",
      publicKey: "02ff",
    });
    expect(calls.some((call) => call.url === "https://auth.twetch.app/api/v1/challenge")).toBe(true);
  });

  it("surfaces Twetch HTTP errors", async () => {
    const twetch = new HttpTwetchClient({
      authUrl: "https://auth.twetch.app",
      apiUrl: "https://api.twetch.app",
      graphqlUrl: "https://api.twetch.app/v1/graphql",
      fetch: async () => jsonResponse(403, { error: "cloudflare" }),
    });
    await expect(twetch.getChallenge()).rejects.toBeInstanceOf(TwetchAuthError);
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