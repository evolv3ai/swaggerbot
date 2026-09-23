import { definePlugin } from "nitro";
import { openDb } from "~/index-store/db";
import { getApp } from "~/server/app-instance";

/**
 * Builds the server's app, which starts the background Verification and
 * forms workers, so a queued Verification, the backfill of Specs without
 * forms and the retry of an interrupted build don't wait for a request. An
 * app that can't be built (`TYPESAFE_API_KEY` unset) is logged and the
 * server starts anyway: `/api/health` answers, and `getApp` tries again on
 * the first request that needs it.
 */
export function startWorkers(get: () => unknown = getApp): void {
  try {
    get();
  } catch (error) {
    console.error(
      "The background Verification and forms workers didn't start:",
      error,
    );
  }
}

/**
 * Opens the Index once when the production server starts, so its migrations
 * run and the WAL-mode database file exists before the first Lookup (and
 * before Litestream looks for it). A database that can't be opened or
 * migrated stops the server here instead of failing the first Lookup. The
 * connection is closed again; the Lookup opens its own. Then starts the
 * workers (`startWorkers`).
 */
export default definePlugin(() => {
  openDb(process.env.DATABASE_PATH || undefined).$client.close();
  startWorkers();
});
