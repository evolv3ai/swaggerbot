import type { LookupPage } from "./lookup-page";

/**
 * The HTTP status and headers a view is served with: a refusal answers as
 * `/api/lookup` would (400 with no name; 429 with `Retry-After` in seconds
 * over the per-IP limit). An Outcome, and a name the Index doesn't hold
 * yet, are answers: 200.
 */
export function lookupPageResponse(page: LookupPage): {
  status: number;
  headers: Record<string, string>;
} {
  switch (page.view) {
    case "name-required":
      return { status: 400, headers: {} };
    case "rate-limited":
      return {
        status: 429,
        headers: { "retry-after": String(page.retryAfterSeconds) },
      };
    case "outcome":
    case "not-in-index":
      return { status: 200, headers: {} };
  }
}
