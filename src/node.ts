import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./config.ts";
import { SCHEMA_SQL, type Db } from "./db.ts";
import { seed } from "./seed.ts";
import { createApp } from "./app.ts";

/** Local node entry (`npm run dev:node`). File-backed SQLite, same app as the Worker. */
function openFileDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
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

const config = loadConfig();
const db = openFileDb(config.databasePath);
await seed(db, { live: config.live, seedExampleClient: true });
const { app } = await createApp(db, config);
const server = app.listen(config.port, () => {
  console.log(`twetch-oidc listening on ${config.issuer} (live=${config.live})`);
});

function shutdown() {
  server.close(() => db.close());
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
