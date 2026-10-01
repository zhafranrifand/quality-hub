import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import * as schema from "./schema.js";
export function openStore(dir: string) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(resolve(dir, "screenshots"), { recursive: true });
  const sqlite = new Database(resolve(dir, "quality.sqlite"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const orm = drizzle(sqlite, { schema });
  migrate(orm, { migrationsFolder: resolve("migrations") });
  const all = <T = any>(sql: string, ...args: any[]): T[] =>
    sqlite.prepare(sql).all(...args) as T[];
  const one = <T = any>(sql: string, ...args: any[]): T | undefined =>
    sqlite.prepare(sql).get(...args) as T | undefined;
  const run = (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...args);
  const insert = (table: any, values: any) =>
    orm.insert(table).values(values).run();
  const log = (action: string, entityId: string) =>
    insert(schema.audit, {
      id: randomUUID(),
      action,
      entityId,
      createdAt: Date.now(),
    });
  return { sqlite, orm, all, one, run, insert, log, dir };
}
export type Store = ReturnType<typeof openStore>;
