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
