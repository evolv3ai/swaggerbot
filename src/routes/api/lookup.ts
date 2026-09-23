import { createFileRoute } from "@tanstack/react-router";
import { defaultDailyQuota } from "~/index-store/keys";
import { createApp } from "~/lookup/app";
import { type Gate, handleLookupRequest, type LookupApp } from "~/lookup/http";
import {
  clientIpHeader,
  createRateLimiter,
  rateLimitPerMinute,
} from "~/lookup/rate-limit";

// Built on the first valid request, which also starts the background
// Verification worker.
let app: LookupApp | undefined;

// One instance (ADR 0002), so the per-IP limit lives in memory.
const gate: Gate = {
  rateLimiter: createRateLimiter({ perMinute: rateLimitPerMinute() }),
  clientIpHeader: clientIpHeader(),
  dailyQuota: defaultDailyQuota(),
};

export const Route = createFileRoute("/api/lookup")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleLookupRequest(
          request,
          () => {
            app ??= createApp();
            return app;
          },
          gate,
        ),
    },
  },
});
