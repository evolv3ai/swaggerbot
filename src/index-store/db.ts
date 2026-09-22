import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export const DEFAULT_DATABASE_PATH = "./data/swaggerbot.db";

/** Where drizzle-kit writes migrations (see `drizzle.config.ts`), relative to the working directory. */
export const MIGRATIONS_FOLDER = "./drizzle";

/**
 * Opens the Index database at `path`, creating its directory if missing,
 * and applies any pending migrations.
 */
export function openDb(
  path: string = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH,
) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

export type Db = ReturnType<typeof openDb>;
