import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { OAuthClientRecord, TwetchUser } from "./types.ts";

export type Db = Database.Database;

export function openDb(databasePath: string): Db {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS oidc_payloads (      model TEXT NOT NULL,
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
  `);
  dropOauthClientOwnerFk(db);
}

function dropOauthClientOwnerFk(db: Db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'oauth_clients'").get() as
    | { sql: string }
    | undefined;
  if (!row?.sql || !/\bREFERENCES\b/i.test(row.sql)) return;

  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE oauth_clients_new (
      client_id TEXT PRIMARY KEY,      client_secret TEXT,
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
    INSERT INTO oauth_clients_new SELECT
      client_id, client_secret, owner_id, client_name, client_uri, logo_uri,
      redirect_uris, post_logout_redirect_uris, token_endpoint_auth_method,
      grant_types, response_types, scope, disabled, created_at, updated_at
    FROM oauth_clients;
    DROP TABLE oauth_clients;
    ALTER TABLE oauth_clients_new RENAME TO oauth_clients;
  `);
  db.pragma("foreign_keys = ON");
}

function mapUser(row: Record<string, unknown>): TwetchUser {  return {
    id: String(row.id),    handle: String(row.handle),
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

export function getUserById(db: Db, id: string): TwetchUser | undefined {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapUser(row) : undefined;
}

export function getUserByEmail(db: Db, email: string): TwetchUser | undefined {
  const row = db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)").get(email) as
    | Record<string, unknown>
    | undefined;
  return row ? mapUser(row) : undefined;
}

export function getUserByHandle(db: Db, handle: string): TwetchUser | undefined {
  const row = db.prepare("SELECT * FROM users WHERE lower(handle) = lower(?)").get(handle) as
    | Record<string, unknown>
    | undefined;
  return row ? mapUser(row) : undefined;
}

export function getUserBySigningAddress(db: Db, address: string): TwetchUser | undefined {
  const row = db.prepare("SELECT * FROM users WHERE signing_address = ?").get(address) as
    | Record<string, unknown>
    | undefined;
  return row ? mapUser(row) : undefined;
}

export function upsertUser(db: Db, user: TwetchUser) {
  db.prepare(`
    INSERT INTO users (
      id, handle, display_name, avatar_url, email, email_verified,
      password_hash, signing_address, signing_pubkey, created_at, updated_at
    ) VALUES (
      @id, @handle, @displayName, @avatarUrl, @email, @emailVerified,
      @passwordHash, @signingAddress, @signingPubkey, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      handle = excluded.handle,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      email = excluded.email,
      email_verified = excluded.email_verified,
      password_hash = excluded.password_hash,
      signing_address = excluded.signing_address,
      signing_pubkey = excluded.signing_pubkey,
      updated_at = excluded.updated_at
  `).run({
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    email: user.email,
    emailVerified: user.emailVerified ? 1 : 0,
    passwordHash: user.passwordHash,
    signingAddress: user.signingAddress,
    signingPubkey: user.signingPubkey,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
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

export function getClient(db: Db, clientId: string): OAuthClientRecord | undefined {
  const row = db.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapClient(row) : undefined;
}

export function listClientsByOwner(db: Db, ownerId: string): OAuthClientRecord[] {
  const rows = db.prepare("SELECT * FROM oauth_clients WHERE owner_id = ? ORDER BY created_at DESC").all(ownerId) as
    Record<string, unknown>[];
  return rows.map(mapClient);
}

export function upsertClient(db: Db, client: OAuthClientRecord) {
  db.prepare(`
    INSERT INTO oauth_clients (
      client_id, client_secret, owner_id, client_name, client_uri, logo_uri,
      redirect_uris, post_logout_redirect_uris, token_endpoint_auth_method,
      grant_types, response_types, scope, disabled, created_at, updated_at
    ) VALUES (
      @clientId, @clientSecret, @ownerId, @clientName, @clientUri, @logoUri,
      @redirectUris, @postLogoutRedirectUris, @tokenEndpointAuthMethod,
      @grantTypes, @responseTypes, @scope, @disabled, @createdAt, @updatedAt
    )
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
      updated_at = excluded.updated_at
  `).run({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    ownerId: client.ownerId,
    clientName: client.clientName,
    clientUri: client.clientUri,
    logoUri: client.logoUri,
    redirectUris: JSON.stringify(client.redirectUris),
    postLogoutRedirectUris: JSON.stringify(client.postLogoutRedirectUris),
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    grantTypes: JSON.stringify(client.grantTypes),
    responseTypes: JSON.stringify(client.responseTypes),
    scope: client.scope,
    disabled: client.disabled ? 1 : 0,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  });
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
    id_token_signed_response_alg: "RS256",
  };
}
export function saveChallenge(db: Db, id: string, message: string, expiresAt: number) {
  db.prepare("INSERT OR REPLACE INTO auth_challenges (id, message, expires_at) VALUES (?, ?, ?)").run(
    id,
    message,
    expiresAt,
  );
}

export function consumeChallenge(db: Db, id: string): string | undefined {
  const row = db.prepare("SELECT message, expires_at FROM auth_challenges WHERE id = ?").get(id) as
    | { message: string; expires_at: number }
    | undefined;
  if (!row) return undefined;
  db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(id);
  if (row.expires_at < Date.now()) return undefined;
  return row.message;
}

export function getSigningKeys(db: Db): Record<string, unknown>[] {
  const rows = db.prepare("SELECT jwk FROM signing_keys ORDER BY created_at ASC").all() as { jwk: string }[];
  return rows.map((row) => JSON.parse(row.jwk));
}

export function insertSigningKey(db: Db, kid: string, jwk: unknown) {
  db.prepare("INSERT INTO signing_keys (kid, jwk, created_at) VALUES (?, ?, ?)").run(
    kid,
    JSON.stringify(jwk),
    Date.now(),
  );
}