import type { Db } from "../db.ts";
import { getClient, toOidcClientMetadata } from "../db.ts";

interface PayloadRow {
  payload: string;
  expires_at: number | null;
  consumed: number;
}

export class SqliteAdapter {
  constructor(
    private db: Db,
    private model: string,
  ) {}

  async upsert(id: string, payload: Record<string, unknown>, expiresIn?: number) {
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;
    this.db.prepare(`
      INSERT INTO oidc_payloads (model, id, payload, expires_at, uid, grant_id, user_code, consumed)
      VALUES (@model, @id, @payload, @expiresAt, @uid, @grantId, @userCode, 0)
      ON CONFLICT(model, id) DO UPDATE SET
        payload = excluded.payload,
        expires_at = excluded.expires_at,
        uid = excluded.uid,
        grant_id = excluded.grant_id,
        user_code = excluded.user_code
    `).run({
      model: this.model,
      id,
      payload: JSON.stringify(payload),
      expiresAt,
      uid: (payload.uid as string | undefined) ?? null,
      grantId: (payload.grantId as string | undefined) ?? null,
      userCode: (payload.userCode as string | undefined) ?? null,
    });
  }

  async find(id: string) {
    if (this.model === "Client") {
      const client = getClient(this.db, id);
      if (!client || client.disabled) return undefined;
      return toOidcClientMetadata(client);
    }
    const row = this.db.prepare(
      "SELECT payload, expires_at, consumed FROM oidc_payloads WHERE model = ? AND id = ?",
    ).get(this.model, id) as PayloadRow | undefined;
    return this.hydrate(row, id);
  }

  async findByUid(uid: string) {
    const row = this.db.prepare(
      "SELECT id, payload, expires_at, consumed FROM oidc_payloads WHERE model = ? AND uid = ?",
    ).get(this.model, uid) as (PayloadRow & { id: string }) | undefined;
    return this.hydrate(row, row?.id);
  }

  async findByUserCode(userCode: string) {
    const row = this.db.prepare(
      "SELECT id, payload, expires_at, consumed FROM oidc_payloads WHERE model = ? AND user_code = ?",
    ).get(this.model, userCode) as (PayloadRow & { id: string }) | undefined;
    return this.hydrate(row, row?.id);
  }

  async consume(id: string) {
    const row = this.db.prepare(
      "SELECT payload FROM oidc_payloads WHERE model = ? AND id = ?",
    ).get(this.model, id) as { payload: string } | undefined;
    if (!row) return;
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    payload.consumed = Math.floor(Date.now() / 1000);
    this.db.prepare(
      "UPDATE oidc_payloads SET payload = ?, consumed = 1 WHERE model = ? AND id = ?",
    ).run(JSON.stringify(payload), this.model, id);
  }

  async destroy(id: string) {
    this.db.prepare("DELETE FROM oidc_payloads WHERE model = ? AND id = ?").run(this.model, id);
  }

  async revokeByGrantId(grantId: string) {
    this.db.prepare("DELETE FROM oidc_payloads WHERE grant_id = ?").run(grantId);
  }

  private hydrate(row: PayloadRow | undefined, id?: string) {
    if (!row) return undefined;
    if (row.expires_at && row.expires_at < Date.now()) {
      if (id) this.destroy(id);
      return undefined;
    }
    return JSON.parse(row.payload);
  }
}

export function createAdapterFactory(db: Db) {
  return (model: string) => new SqliteAdapter(db, model);
}