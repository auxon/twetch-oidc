import type { OAuthClientRecord, TwetchUser } from "./types.ts";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  email TEXT UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  signing_address TEXT UNIQUE,
  signing_pubkey TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret TEXT,
  owner_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_uri TEXT,
  logo_uri TEXT,
  redirect_uris TEXT NOT NULL,
  post_logout_redirect_uris TEXT NOT NULL DEFAULT '[]',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_basic',
  grant_types TEXT NOT NULL,
  response_types TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'openid profile email',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oidc_payloads (
  model TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER,
  uid TEXT,
  grant_id TEXT,
  user_code TEXT,
  consumed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (model, id)
);

CREATE INDEX IF NOT EXISTS oidc_payloads_uid ON oidc_payloads(uid);
CREATE INDEX IF NOT EXISTS oidc_payloads_grant ON oidc_payloads(grant_id);
CREATE INDEX IF NOT EXISTS oidc_payloads_user_code ON oidc_payloads(user_code);

CREATE TABLE IF NOT EXISTS signing_keys (
  kid TEXT PRIMARY KEY,
  jwk TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export interface Db {
  first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<void>;
  exec(sql: string): Promise<void>;
  close(): void;
}

export function fromD1(d1: D1Database): Db {
  return {
    async first<T>(sql: string, ...params: unknown[]) {
      const row = await d1.prepare(sql).bind(...params).first<T>();
      return row ?? undefined;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      const { results } = await d1.prepare(sql).bind(...params).all<T>();
      return (results ?? []) as T[];
    },
    async run(sql: string, ...params: unknown[]) {
      await d1.prepare(sql).bind(...params).run();
    },
    async exec(sql: string) {
      await d1.exec(sql);
    },
    close() {},
  };
}

function mapUser(row: Record<string, unknown>): TwetchUser {
  return {
    id: String(row.id),
    handle: String(row.handle),
    displayName: String(row.display_name),
    avatarUrl: (row.avatar_url as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    emailVerified: Boolean(row.email_verified),
    passwordHash: (row.password_hash as string | null) ?? null,
    signingAddress: (row.signing_address as string | null) ?? null,
    signingPubkey: (row.signing_pubkey as string | null) ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function getUserById(db: Db, id: string): Promise<TwetchUser | undefined> {
  const row = await db.first("SELECT * FROM users WHERE id = ?", id);
  return row ? mapUser(row) : undefined;
}

export async function getUserByEmail(db: Db, email: string): Promise<TwetchUser | undefined> {
  const row = await db.first("SELECT * FROM users WHERE lower(email) = lower(?)", email);
  return row ? mapUser(row) : undefined;
}

export async function getUserByHandle(db: Db, handle: string): Promise<TwetchUser | undefined> {
  const row = await db.first("SELECT * FROM users WHERE lower(handle) = lower(?)", handle);
  return row ? mapUser(row) : undefined;
}

export async function getUserBySigningAddress(db: Db, address: string): Promise<TwetchUser | undefined> {
  const row = await db.first("SELECT * FROM users WHERE signing_address = ?", address);
  return row ? mapUser(row) : undefined;
}

export async function upsertUser(db: Db, user: TwetchUser) {
  await db.run(
    `INSERT INTO users (
      id, handle, display_name, avatar_url, email, email_verified,
      password_hash, signing_address, signing_pubkey, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      handle = excluded.handle,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      email = excluded.email,
      email_verified = excluded.email_verified,
      password_hash = excluded.password_hash,
      signing_address = excluded.signing_address,
      signing_pubkey = excluded.signing_pubkey,
      updated_at = excluded.updated_at`,
    user.id,
    user.handle,
    user.displayName,
    user.avatarUrl,
    user.email,
    user.emailVerified ? 1 : 0,
    user.passwordHash,
    user.signingAddress,
    user.signingPubkey,
    user.createdAt,
    user.updatedAt,
  );
}

function mapClient(row: Record<string, unknown>): OAuthClientRecord {
  return {
    clientId: String(row.client_id),
    clientSecret: (row.client_secret as string | null) ?? null,
    ownerId: String(row.owner_id),
    clientName: String(row.client_name),
    clientUri: (row.client_uri as string | null) ?? null,
    logoUri: (row.logo_uri as string | null) ?? null,
    redirectUris: JSON.parse(String(row.redirect_uris)),
    postLogoutRedirectUris: JSON.parse(String(row.post_logout_redirect_uris ?? "[]")),
    tokenEndpointAuthMethod: row.token_endpoint_auth_method as OAuthClientRecord["tokenEndpointAuthMethod"],
    grantTypes: JSON.parse(String(row.grant_types)),
    responseTypes: JSON.parse(String(row.response_types)),
    scope: String(row.scope),
    disabled: Boolean(row.disabled),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function getClient(db: Db, clientId: string): Promise<OAuthClientRecord | undefined> {
  const row = await db.first("SELECT * FROM oauth_clients WHERE client_id = ?", clientId);
  return row ? mapClient(row) : undefined;
}

export async function listClientsByOwner(db: Db, ownerId: string): Promise<OAuthClientRecord[]> {
  const rows = await db.all("SELECT * FROM oauth_clients WHERE owner_id = ? ORDER BY created_at DESC", ownerId);
  return rows.map(mapClient);
}

export async function upsertClient(db: Db, client: OAuthClientRecord) {
  await db.run(
    `INSERT INTO oauth_clients (
      client_id, client_secret, owner_id, client_name, client_uri, logo_uri,
      redirect_uris, post_logout_redirect_uris, token_endpoint_auth_method,
      grant_types, response_types, scope, disabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      client_secret = excluded.client_secret,
      client_name = excluded.client_name,
      client_uri = excluded.client_uri,
      logo_uri = excluded.logo_uri,
      redirect_uris = excluded.redirect_uris,
      post_logout_redirect_uris = excluded.post_logout_redirect_uris,
      token_endpoint_auth_method = excluded.token_endpoint_auth_method,
      grant_types = excluded.grant_types,
      response_types = excluded.response_types,
      scope = excluded.scope,
      disabled = excluded.disabled,
      updated_at = excluded.updated_at`,
    client.clientId,
    client.clientSecret,
    client.ownerId,
    client.clientName,
    client.clientUri,
    client.logoUri,
    JSON.stringify(client.redirectUris),
    JSON.stringify(client.postLogoutRedirectUris),
    client.tokenEndpointAuthMethod,
    JSON.stringify(client.grantTypes),
    JSON.stringify(client.responseTypes),
    client.scope,
    client.disabled ? 1 : 0,
    client.createdAt,
    client.updatedAt,
  );
}

export function toOidcClientMetadata(client: OAuthClientRecord) {
  return {
    client_id: client.clientId,
    client_secret: client.clientSecret ?? undefined,
    client_name: client.clientName,
    client_uri: client.clientUri ?? undefined,
    logo_uri: client.logoUri ?? undefined,
    redirect_uris: client.redirectUris,
    post_logout_redirect_uris: client.postLogoutRedirectUris,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    scope: client.scope,
    application_type: "web",
    subject_type: "public",
    id_token_signed_response_alg: "ES256",
  };
}

export async function saveChallenge(db: Db, id: string, message: string, expiresAt: number) {
  await db.run(
    "INSERT OR REPLACE INTO auth_challenges (id, message, expires_at) VALUES (?, ?, ?)",
    id,
    message,
    expiresAt,
  );
}

export async function consumeChallenge(db: Db, id: string): Promise<string | undefined> {
  const row = await db.first<{ message: string; expires_at: number }>(
    "SELECT message, expires_at FROM auth_challenges WHERE id = ?",
    id,
  );
  if (!row) return undefined;
  await db.run("DELETE FROM auth_challenges WHERE id = ?", id);
  if (row.expires_at < Date.now()) return undefined;
  return row.message;
}

export async function getSigningKeys(db: Db): Promise<Record<string, unknown>[]> {
  const rows = await db.all<{ jwk: string }>("SELECT jwk FROM signing_keys ORDER BY created_at ASC");
  return rows.map((row) => JSON.parse(row.jwk));
}

export async function insertSigningKey(db: Db, kid: string, jwk: unknown) {
  await db.run("INSERT INTO signing_keys (kid, jwk, created_at) VALUES (?, ?, ?)", kid, JSON.stringify(jwk), Date.now());
}
