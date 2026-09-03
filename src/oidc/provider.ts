import { Provider } from "oidc-provider";
import type { AppConfig } from "../config.ts";
import type { Db } from "../db.ts";
import type { TwetchClient } from "../twetch/types.ts";
import { createAdapterFactory } from "./adapter.ts";
import { createFindAccount } from "./account.ts";

export function createProvider(
  db: Db,
  config: AppConfig,
  jwks: { keys: unknown[] },
  twetch?: TwetchClient,
) {
  const provider = new Provider(config.issuer, {
    adapter: createAdapterFactory(db),
    clients: [],
    findAccount: createFindAccount(db, twetch),
    jwks: jwks as { keys: never[] },
    cookies: {
      keys: config.cookieKeys,
    },
    routes: {
      authorization: "/authorize",
      token: "/token",
      userinfo: "/userinfo",
      jwks: "/jwks",
      revocation: "/revoke",
      end_session: "/logout",
    },
    pkce: {
      required: () => true,
    },
    responseTypes: ["code"],
    claims: {
      openid: ["sub"],
      profile: [
        "name",
        "preferred_username",
        "picture",
        "profile",
        "updated_at",
        "twetch_pubkey",
      ],
      email: ["email", "email_verified"],
    },
    scopes: ["openid", "profile", "email", "offline_access"],
    conformIdTokenClaims: false,
    features: {
      devInteractions: { enabled: false },
      revocation: { enabled: true },
      rpInitiatedLogout: { enabled: true },
      userinfo: { enabled: true },
    },
    ttl: {
      AccessToken: 60 * 60,
      AuthorizationCode: 60,
      IdToken: 60 * 60,
      RefreshToken: 14 * 24 * 60 * 60,
      Interaction: 60 * 60,
      Session: 14 * 24 * 60 * 60,
      Grant: 14 * 24 * 60 * 60,
    },
    rotateRefreshToken: true,
    issueRefreshToken: async (_ctx: unknown, client: { grantTypeAllowed(type: string): boolean }, code: { scopes: Set<string> }) => {
      if (!client.grantTypeAllowed("refresh_token")) return false;
      return code.scopes.has("offline_access");
    },
    interactions: {
      url: (_ctx: unknown, interaction: { uid: string }) => `/interaction/${interaction.uid}`,
    },
    clientBasedCORS: () => true,
    renderError: async (ctx: { type: string; body: string }, out: Record<string, unknown>) => {
      ctx.type = "html";
      ctx.body = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Twetch login error</title>
  <link rel="stylesheet" href="/public/twetch.css" />
</head>
<body class="page">
  <main class="card">
    <h1>Something went wrong</h1>
    ${Object.entries(out)
      .map(([key, value]) => `<p><strong>${key}</strong> ${String(value)}</p>`)
      .join("")}
    <a class="btn secondary" href="/">Back</a>
  </main>
</body>
</html>`;
    },
  });

  provider.proxy = config.isProduction;
  return provider;
}