import type { Outcome } from "~/domain/outcome";
import { answerLookup, type Gate, type LookupApp } from "~/lookup/http";
import type { LookupRequest } from "~/lookup/lookup";
import { clientIpOf } from "~/lookup/rate-limit";
import { freshnessMs } from "~/lookup/thresholds";
import { type LookupSearch, lookupRequestOf } from "./lookup-search";

/**
 * What the `/lookup` page shows, one view per answer:
 *
 * - `name-required`: the query has no name;
 * - `rate-limited`: the client IP is over the per-IP limit, with when to retry;
 * - `outcome`: the Index answered, with the Outcome and how long it took;
 * - `not-in-index`: the Index doesn't know the name, and Discovery needs a
 *   key the page doesn't have.
 *
 * `baseUrl` is where this service is reached, for the `curl` and MCP calls
 * a page shows.
 */
export type LookupPage =
  | { view: "name-required" }
  | {
      view: "rate-limited";
      request: LookupRequest;
      retryAfterSeconds: number;
    }
  | {
      view: "outcome";
      request: LookupRequest;
      outcome: Outcome;
      /** How long the Index took to answer, in milliseconds. */
      ms: number;
      /** Verified longer ago than the freshness window: still the answer, queued for Verification. */
      stale: boolean;
    }
  | { view: "not-in-index"; request: LookupRequest; baseUrl: string };

export type LookupPageDeps = {
  /** The app, built only when a Lookup runs. */
  getApp: () => LookupApp;
  gate: Pick<Gate, "rateLimiter" | "clientIpHeader" | "dailyQuota" | "now">;
  /** The page's request: its client IP, for the per-IP limit. */
  request: Request;
  freshnessDays: number;
  /** `PUBLIC_BASE_URL`; without it, the request's origin. */
  publicBaseUrl?: string;
};

/**
 * The `/lookup` page's answer. It runs the Lookup under the rules every
 * surface shares (`answerLookup`), always **with no key** (Slice 6 backlog,
 * D5): whatever the request carries, an `Authorization` header included, is
 * never read, so only the Index answers and no quota is used. A request
 * with no name runs nothing and takes nothing from the per-IP limit.
 */
export async function answerLookupPage(
  search: LookupSearch,
  { getApp, gate, request, freshnessDays, publicBaseUrl }: LookupPageDeps,
): Promise<LookupPage> {
  const lookup = lookupRequestOf(search);
  if (!lookup) return { view: "name-required" };

  const limited = gate.rateLimiter.take(
    clientIpOf(request, gate.clientIpHeader),
  );
  if (!limited.allowed)
    return {
      view: "rate-limited",
      request: lookup,
      retryAfterSeconds: limited.retryAfterSeconds,
    };

  const started = performance.now();
  const answer = await answerLookup(lookup, undefined, getApp(), gate);
  const ms = Math.round((performance.now() - started) * 10) / 10;
  if (answer.status !== 200)
    return {
      view: "not-in-index",
      request: lookup,
      baseUrl: (publicBaseUrl ?? new URL(request.url).origin).replace(
        /\/+$/,
        "",
      ),
    };

  const outcome = answer.body;
  const now = gate.now?.() ?? new Date();
  const verifiedAt = "verifiedAt" in outcome ? outcome.verifiedAt : undefined;
  const age = verifiedAt ? now.getTime() - Date.parse(verifiedAt) : Number.NaN;
  return {
    view: "outcome",
    request: lookup,
    outcome,
    ms,
    stale: verifiedAt !== undefined && !(age <= freshnessMs(freshnessDays)),
  };
}
