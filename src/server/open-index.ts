import { definePlugin } from "nitro";
import { openDb } from "~/index-store/db";

/**
 * Opens the Index once when the production server starts, so its migrations
 * run and the WAL-mode database file exists before the first Lookup (and
 * before Litestream looks for it). A database that can't be opened or
 * migrated stops the server here instead of failing the first Lookup. The
 * connection is closed again; the Lookup opens its own.
 */
export default definePlugin(() => {
  openDb(process.env.DATABASE_PATH || undefined).$client.close();
});
