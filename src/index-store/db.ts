import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export const DEFAULT_DATABASE_PATH = "./data/swaggerbot.db";

/** Opens the Index database at `path`, creating its directory if missing. */
export function openDb(
  path: string = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH,
) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle({ client: sqlite });
}

export type Db = ReturnType<typeof openDb>;
