import type { TwetchAuthenticateInput, TwetchClient, TwetchProfile } from "./types.ts";
import { TwetchAuthError } from "./types.ts";

export interface HttpTwetchClientOptions {
  authUrl: string;
  apiUrl: string;
  graphqlUrl: string;
  fetch?: typeof fetch;
}

const ME_QUERY = `
  query OidcMe {
    me {
      id
      name
      icon
      profilePhoto
      publicKey
    }
  }
`;

const ME_QUERY_MIN = `
  query OidcMeMin {
    me {
      id
      name
      publicKey
    }
  }
`;

const USER_BY_ID_QUERY = `
  query OidcUser($id: BigInt!) {
    userById(id: $id) {
      id
      name
      icon
      profilePhoto
      publicKey
    }
  }
`;

export class HttpTwetchClient implements TwetchClient {
  private readonly fetchImpl: typeof fetch;
  private readonly opts: HttpTwetchClientOptions;

  constructor(opts: HttpTwetchClientOptions) {
    this.opts = {
      authUrl: trimSlash(opts.authUrl),
      apiUrl: trimSlash(opts.apiUrl),
      graphqlUrl: trimSlash(opts.graphqlUrl),
      fetch: opts.fetch,
    };
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async getChallenge(): Promise<string> {
    const data = await this.requestJson("GET", `${this.opts.authUrl}/api/v1/challenge`);
    const message = typeof data.message === "string" ? data.message : typeof data === "string" ? data : undefined;      throw new TwetchAuthError("Twetch challenge response did not include a message");
    }
    return message;
  }

  async authenticate(input: TwetchAuthenticateInput): Promise<string> {
    const data = await this.requestJson("POST", `${this.opts.authUrl}/api/v1/authenticate`, {
      message: input.message,
      signature: input.signature,
      address: input.address,
      v2: true,
    });
    if (typeof data.token !== "string" || !data.token) {
      throw new TwetchAuthError("Twetch authenticate did not return a token");
    }
    return data.token;
  }

  async me(token: string): Promise<TwetchProfile> {
    const fromAuth = await this.meFromAuthApi(token);
    if (fromAuth) return fromAuth;
    const fromGraphql = await this.graphqlMe(token, ME_QUERY).catch(() => this.graphqlMe(token, ME_QUERY_MIN));
    if (!fromGraphql) {
      throw new TwetchAuthError("Twetch did not return a profile for this token");
    }
    return fromGraphql;
  }

  async userById(id: string, token?: string): Promise<TwetchProfile | undefined> {
    try {
      const data = await this.graphql(token, USER_BY_ID_QUERY, { id });
      const node = (data.userById ?? data.user_by_id) as Record<string, unknown> | undefined;
      return node ? mapProfile(node) : undefined;
    } catch {
      return undefined;
    }
  }

  private async meFromAuthApi(token: string): Promise<TwetchProfile | undefined> {
    for (const method of ["GET", "POST"] as const) {
      try {
        const data = await this.requestJson(
          method,
          `${this.opts.authUrl}/api/v1/me`,
          method === "POST" ? {} : undefined,
          token,
        );
        const node = (data.me as Record<string, unknown> | undefined) ?? data;
        if (!node || typeof node !== "object" || node.id == null) continue;
        return mapProfile(node);
      } catch {
        // Auth `/me` is not in every Twetch deploy; GraphQL is the fallback.
      }
    }
    return undefined;
  }

  private async graphqlMe(token: string, query: string): Promise<TwetchProfile | undefined> {    const data = await this.graphql(token, query);
    const node = data.me as Record<string, unknown> | undefined;
    return node ? mapProfile(node) : undefined;
  }

  private async graphql(token: string | undefined, query: string, variables?: Record<string, unknown>) {
    const data = await this.requestJson("POST", this.opts.graphqlUrl, { query, variables: variables ?? null }, token);
    if (data.errors) {
      const message = Array.isArray(data.errors)
        ? data.errors.map((err: { message?: string }) => err.message).join("; ")
        : "GraphQL error";
      throw new TwetchAuthError(message);
    }
    return (data.data ?? data) as Record<string, unknown>;
  }

  private async requestJson(
    method: string,
    url: string,
    body?: unknown,
    token?: string,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "twetch-oidc/1.0",
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new TwetchAuthError(
        `Twetch ${method} ${url} failed (${res.status}): ${text.slice(0, 200)}`,
        res.status,
      );
    }
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new TwetchAuthError(`Twetch ${url} returned non-JSON`);
    }
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function mapProfile(node: Record<string, unknown>): TwetchProfile {
  const id = String(node.id ?? "");
  if (!id) {    throw new TwetchAuthError("Twetch profile is missing id");
  }
  const name = String(node.name ?? node.username ?? `Twetch ${id}`);
  const picture =
    (typeof node.icon === "string" && node.icon) ||
    (typeof node.profilePhoto === "string" && node.profilePhoto) ||
    (typeof node.profile_photo === "string" && node.profile_photo) ||
    undefined;
  const publicKey = typeof node.publicKey === "string" ? node.publicKey : typeof node.public_key === "string" ? node.public_key : undefined;
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