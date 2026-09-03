function loadDotEnv() {
  try {
    const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const envPath = path.resolve(process.cwd(), ".env");
    if (!existsSync(envPath)) return;
    for (const raw of readFileSync(envPath, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Workers have no local .env; secrets and vars come from the runtime.
  }
}

loadDotEnv();

export function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export interface TwetchNetworkConfig {
  authUrl: string;
  apiUrl: string;
  graphqlUrl: string;
  authFrontendUrl: string;
}

export interface AppConfig {
  issuer: string;
  port: number;
  cookieKeys: string[];
  sessionSecret: string;
  databasePath: string;
  demoMode: boolean;
  live: boolean;
  isProduction: boolean;
  twetch: TwetchNetworkConfig;
}

function envFlag(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  return raw === "1" || raw.toLowerCase() === "true";
}

function defaultLive(): boolean {
  // NODE_ENV is typed by the generated worker types; read through a plain
  // string so local/test/production comparisons all typecheck.
  const nodeEnv: string | undefined = process.env.NODE_ENV;
  if (nodeEnv === "test" || process.env.VITEST) return false;
  return envFlag("TWETCH_LIVE") ?? false;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const isProduction = overrides.isProduction ?? process.env.NODE_ENV === "production";
  const port = Number(overrides.port ?? process.env.PORT ?? 3000);
  const issuer = overrides.issuer ?? process.env.ISSUER ?? `http://localhost:${port}`;
  const live = overrides.live ?? defaultLive();
  const demoMode = overrides.demoMode ?? (live ? false : envFlag("TWETCH_DEMO_MODE") !== false);

  return {
    issuer,
    port,
    cookieKeys: (process.env.COOKIE_KEYS ?? "dev-cookie-key-change-me-please-32b").split(","),
    sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret-change-me-please-32b",
    databasePath: overrides.databasePath ?? process.env.DATABASE_PATH ?? "./data/twetch-oidc.sqlite",
    demoMode,
    live,
    isProduction,
    twetch: overrides.twetch ?? {
      authUrl: process.env.TWETCH_AUTH_URL ?? "https://api.twetch.com",
      apiUrl: process.env.TWETCH_API_URL ?? "https://api.twetch.com",
      graphqlUrl: process.env.TWETCH_GRAPHQL_URL ?? "https://api.twetch.com",
      authFrontendUrl: process.env.TWETCH_AUTH_FRONTEND_URL ?? "https://twetch.com",
    },
  };
}
