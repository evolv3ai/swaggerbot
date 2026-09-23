import { defaultDailyQuota } from "~/index-store/keys";
import { createApp } from "~/lookup/app";
import { type Gate, rateLimited } from "~/lookup/http";
import {
  clientIpHeader,
  createRateLimiter,
  rateLimitPerMinute,
} from "~/lookup/rate-limit";

export type App = ReturnType<typeof createApp>;

// Built on the first request that needs it, which also starts the background
// Verification and forms workers. One per server: every route shares its
// database connection and workers.
let app: App | undefined;

/** The server's one app, built on the first call. */
export function getApp(): App {
  app ??= createApp();
  return app;
}

/**
 * The limits every route enforces. One instance (ADR 0002), so the per-IP
 * limit lives in memory, and it is shared: a Caller has
 * `RATE_LIMIT_PER_MINUTE` requests a minute across all routes, not per route.
 */
export const gate: Gate = {
  rateLimiter: createRateLimiter({ perMinute: rateLimitPerMinute() }),
  clientIpHeader: clientIpHeader(),
  dailyQuota: defaultDailyQuota(),
};

/**
 * Runs an open GET route (no API key, no quota): 429 with `retry-after`
 * when the client IP is over the shared per-IP limit, else `handler`'s
 * response.
 */
export async function openGet(
  request: Request,
  handler: () => Response | Promise<Response>,
): Promise<Response> {
  return rateLimited(request, gate) ?? handler();
}
