import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadDotEnv() {
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
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return false;
  return envFlag("TWETCH_LIVE") ?? false;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const isProduction = process.env.NODE_ENV === "production";
  const port = Number(overrides.port ?? process.env.PORT ?? 3000);
  const issuer =
    overrides.issuer ??
    process.env.ISSUER ??
    `http://localhost:${port}`;
  const live = overrides.live ?? defaultLive();
  const demoMode = overrides.demoMode ?? (live ? false : envFlag("TWETCH_DEMO_MODE") !== false);

  return {
    issuer,
    port,
    cookieKeys: (process.env.COOKIE_KEYS ?? "dev-cookie-key-change-me-please-32b").split(","),
    sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret-change-me-please-32b",
    databasePath: overrides.databasePath ?? process.env.DATABASE_PATH ?? "./data/twetch-oidc.sqlite",
    demoMode: overrides.demoMode ?? (process.env.TWETCH_DEMO_MODE ?? "true") !== "false",
    isProduction,
  };
}