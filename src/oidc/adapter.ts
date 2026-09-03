import type { Db } from "../db.ts";
import { getClient, toOidcClientMetadata } from "../db.ts";

interface PayloadRow {
  payload: string;
  expires_at: number | null;
  consumed: number;
  id?: string;
}

export class SqliteAdapter {
  constructor(
    private db: Db,
    private model: string,
  ) {}

  async upsert(id: string, payload: Record<string, unknown>, expiresIn?: number) {
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;
    await this.db.run(
      `INSERT INTO oidc_payloads (model, id, payload, expires_at, uid, grant_id, user_code, consumed)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(model, id) DO UPDATE SET
        payload = excluded.payload,
        expires_at = excluded.expires_at,
        uid = excluded.uid,
        grant_id = excluded.grant_id,
        user_code = excluded.user_code`,
      this.model,
      id,
      JSON.stringify(payload),
      expiresAt,
      (payload.uid as string | undefined) ?? null,
      (payload.grantId as string | undefined) ?? null,
      (payload.userCode as string | undefined) ?? null,
    );
  }

  async find(id: string) {
    if (this.model === "Client") {
      const client = await getClient(this.db, id);
      if (!client || client.disabled) return undefined;
      return toOidcClientMetadata(client);
    }
    const row = await this.db.first<PayloadRow>(
      "SELECT payload, expires_at, consumed FROM oidc_payloads WHERE model = ? AND id = ?",
      this.model,
      id,
    );
    return this.hydrate(row, id);
  }

  async findByUid(uid: string) {
    const row = await this.db.first<PayloadRow>(
      "SELECT id, payload, expires_at, consumed FROM oidc_payloads WHERE model = ? AND uid = ?",
      this.model,
      uid,
    );
    return this.hydrate(row, row?.id);
  }

  async findByUserCode(userCode: string) {
    const row = await this.db.first<PayloadRow>(
      "SELECT id, payload, expires_at, consumed FROM oidc_payloads WHERE model = ? AND user_code = ?",
      this.model,
      userCode,
    );
    return this.hydrate(row, row?.id);
  }

  async consume(id: string) {
    const row = await this.db.first<{ payload: string }>(
      "SELECT payload FROM oidc_payloads WHERE model = ? AND id = ?",
      this.model,
      id,
    );
    if (!row) return;
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    payload.consumed = Math.floor(Date.now() / 1000);
    await this.db.run(
      "UPDATE oidc_payloads SET payload = ?, consumed = 1 WHERE model = ? AND id = ?",
      JSON.stringify(payload),
      this.model,
      id,
    );
  }

  async destroy(id: string) {
    await this.db.run("DELETE FROM oidc_payloads WHERE model = ? AND id = ?", this.model, id);
  }

  async revokeByGrantId(grantId: string) {
    await this.db.run("DELETE FROM oidc_payloads WHERE grant_id = ?", grantId);
  }

  private async hydrate(row: PayloadRow | undefined, id?: string) {
    if (!row) return undefined;
    if (row.expires_at && row.expires_at < Date.now()) {
      if (id) await this.destroy(id);
      return undefined;
    }
    return JSON.parse(row.payload);
  }
}

export function createAdapterFactory(db: Db) {
  return (model: string) => new SqliteAdapter(db, model);
}
