import { generateWallet } from "../auth/bitcoin.ts";
import type {
  TwetchAuthenticateInput,
  TwetchChallenge,
  TwetchClient,
  TwetchExternalAlgorithm,
  TwetchProfile,
} from "./types.ts";
import { TwetchAuthError } from "./types.ts";

export interface HttpTwetchClientOptions {
  authUrl: string;
  apiUrl: string;
  graphqlUrl: string;
  fetch?: typeof fetch;
}

const CHALLENGE_RE = /^twetch-login:([0-9a-fA-F]+):(\d+)$/;

export function inferTwetchAlgorithm(address: string, explicit?: string): TwetchExternalAlgorithm {
  const requested = (explicit ?? "").trim();
  if (requested === "BTC_BIP322" || requested === "ETH_PERSONAL" || requested === "SOLANA_ED25519") {
    return requested;
  }
  const addr = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return "ETH_PERSONAL";
  if (/^(bc1|tb1|[13mn])/i.test(addr)) return "BTC_BIP322";
  return "SOLANA_ED25519";
}

export function parseLoginChallenge(message: string): { nonce?: string; ts?: number } {
  const match = CHALLENGE_RE.exec(message.trim());
  if (!match) return {};
  return { nonce: match[1], ts: Number(match[2]) };
}

export class HttpTwetchClient implements TwetchClient {
  private readonly customFetch?: typeof fetch;
  private readonly opts: HttpTwetchClientOptions;

  constructor(opts: HttpTwetchClientOptions) {
    this.opts = {
      authUrl: trimSlash(opts.authUrl),
      apiUrl: trimSlash(opts.apiUrl),
      graphqlUrl: trimSlash(opts.graphqlUrl),
    };
    this.customFetch = opts.fetch;
  }

  async getChallenge(): Promise<TwetchChallenge> {
    const data = await this.requestJson("POST", `${this.opts.apiUrl}/v1/auth/login-challenge`, {});
    const message =
      (typeof data.challenge === "string" && data.challenge) ||
      (typeof data.message === "string" && data.message) ||
      undefined;
    if (!message) {
      throw new TwetchAuthError("Twetch challenge response did not include a message");
    }
    const parsed = parseLoginChallenge(message);
    const nonce = typeof data.nonce === "string" ? data.nonce : parsed.nonce;
    const tsRaw = data.ts ?? parsed.ts;
    const ts = typeof tsRaw === "number" ? tsRaw : Number(tsRaw);
    return {
      message,
      nonce,
      ts: Number.isFinite(ts) ? ts : undefined,
    };
  }

  async authenticate(input: TwetchAuthenticateInput): Promise<string> {
    const parsed = parseLoginChallenge(input.message);
    const nonce = input.nonce ?? parsed.nonce;
    const ts = input.ts ?? parsed.ts;
    if (!nonce || ts == null || !Number.isFinite(ts)) {
      throw new TwetchAuthError("Twetch challenge is missing nonce/ts", 400);
    }
    const device = generateWallet();
    const data = await this.requestJson("POST", `${this.opts.apiUrl}/v1/auth/login-external`, {
      algorithm: inferTwetchAlgorithm(input.address, input.algorithm),
      address: input.address,
      signature: input.signature,
      nonce,
      ts,
      devicePubkey: device.publicKeyHex,
    });
    const userId = data.userId ?? data.user_id ?? data.id;
    if (userId == null || userId === "") {
      throw new TwetchAuthError("Twetch login-external did not return a user id");
    }
    return String(userId);
  }

  async me(token: string): Promise<TwetchProfile> {
    const id = token.trim();
    if (!id) {
      throw new TwetchAuthError("A Twetch user id is required.", 400);
    }
    const profile = await this.userById(id);
    if (!profile) {
      throw new TwetchAuthError("Twetch did not return a profile for this account", 404);
    }
    return profile;
  }

  async userById(id: string): Promise<TwetchProfile | undefined> {
    try {
      const data = await this.requestJson("GET", `${this.opts.apiUrl}/v1/users/${encodeURIComponent(id)}`);
      if (data.id == null) return undefined;
      return mapProfile(data);
    } catch (err) {
      if (err instanceof TwetchAuthError && (err.status === 404 || err.status === 400)) {
        return undefined;
      }
      throw err;
    }
  }

  async userByPubkey(publicKey: string): Promise<TwetchProfile | undefined> {
    const key = publicKey.trim();
    if (!key) return undefined;
    try {
      const data = await this.requestJson(
        "GET",
        `${this.opts.apiUrl}/v1/auth/user-by-pubkey/${encodeURIComponent(key)}`,
      );
      const userId = data.userId ?? data.user_id ?? data.id;
      if (userId == null || userId === "") return undefined;
      return this.userById(String(userId));
    } catch (err) {
      if (err instanceof TwetchAuthError && (err.status === 404 || err.status === 400)) {
        return undefined;
      }
      throw err;
    }
  }

  private async requestJson(method: string, url: string, body?: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "twetch-oidc/1.0",
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = this.customFetch
      ? await this.customFetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      : await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
    const text = await res.text();
    if (!res.ok) {
      throw new TwetchAuthError(`Twetch ${method} ${pathOf(url)} failed (${res.status}): ${summarizeTwetchError(text)}`, res.status);
    }
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new TwetchAuthError(`Twetch ${pathOf(url)} returned non-JSON`);
    }
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function summarizeTwetchError(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "empty error body";
  if (trimmed.startsWith("<") || /<html/i.test(trimmed)) {
    const title = trimmed.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
    return title || "upstream returned HTML";
  }
  try {
    const json = JSON.parse(trimmed) as { error?: unknown; message?: unknown; detail?: unknown };
    const message = json.error ?? json.message ?? json.detail;
    if (typeof message === "string" && message) return message;
  } catch {
    // fall through to a short plaintext slice
  }
  return trimmed.slice(0, 200);
}

export function mapProfile(node: Record<string, unknown>): TwetchProfile {
  const id = String(node.id ?? "");
  if (!id) {
    throw new TwetchAuthError("Twetch profile is missing id");
  }
  const name = String(node.name ?? node.username ?? `Twetch ${id}`);
  const picture =
    (typeof node.icon === "string" && node.icon) ||
    (typeof node.profilePhoto === "string" && node.profilePhoto) ||
    (typeof node.profile_photo === "string" && node.profile_photo) ||
    undefined;
  const publicKey =
    typeof node.publicKey === "string"
      ? node.publicKey
      : typeof node.public_key === "string"
        ? node.public_key
        : undefined;
  const email = typeof node.email === "string" && node.email.includes("@") ? node.email : undefined;
  return {
    id,
    name,
    handle: String(node.username ?? name).replace(/^@/, "") || `u${id}`,
    picture,
    publicKey,
    email,
  };
}
