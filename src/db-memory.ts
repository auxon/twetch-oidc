import Database from "better-sqlite3";
import { SCHEMA_SQL, type Db } from "./db.ts";

export function openMemoryDb(): Db {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(SCHEMA_SQL);
  return {
    async first<T>(sql: string, ...params: unknown[]) {
      return (sqlite.prepare(sql).get(...params) as T | undefined) ?? undefined;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, ...params: unknown[]) {
      sqlite.prepare(sql).run(...params);
    },
    async exec(sql: string) {
      sqlite.exec(sql);
    },
    close() {
      sqlite.close();
    },
  };
}
