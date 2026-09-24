# Slice 4 result: Spec forms and navigation

**Acceptance** ([backlog](slice-4-backlog.md)): the Normalized Form (with Swagger 2 → OpenAPI conversion and bundling), Validity Issues, download URLs for both forms, `get_spec_outline`, `get_operation` and `list_vendor_apis` work on the largest Benchmark Specs without timeouts. This is measured in production by `scripts/formscheck.ts` on GitHub, Stripe and Cloudflare. Nothing may cost what Slice 3 bought: False Resolution stays < 2% on `pnpm bench`, and Discovery p90 stays < 15 s.

**Forms, navigation and Discovery pass. False Resolution passes only if Wes accepts two Benchmark label additions (below). Awaiting Wes.**

| Condition | Target | Measured | |
|---|---|---|---|
| Forms and navigation on GitHub, Stripe and Cloudflare | no timeouts | `formscheck` **PASS**: outline p90 **150 ms**, operation p90 **347 ms**, downloads ≤ 0.5 s (26 MB) | pass |
| Outline p90 | < 500 ms | 150 ms | pass |
| Operation p90 | < 2 s | 347 ms | pass |
| Discovery (production `loadcheck --only discovery`) | p90 < 15 s | **p90 13.7 s** (p50 8.7 s, max 16.5 s; 40/40, 0 errors, 0 429s) | pass |
| False Resolution (`pnpm bench --concurrency 1`, twice) | < 2% | **1/20 and 2/20** as scored. Each is the Vendor's own Spec at a URL `specSources` doesn't list. **0/20 and 0/20** if both URLs are added | Wes decides |
| Index answers during the backfill | p90 < 200 ms (ADR 0004) | **p90 80 ms** (p50 63 ms, max 207 ms) | pass |

## How it was measured

- **Production:** image `30d7ebf` for `formscheck` (18:48 CDT) and `d725125` for Discovery (19:03), both 2026-09-23. They ran from WOPR3 through Cloudflare, with the load-check key. [`docs/deploy.md`](../deploy.md) has the per-name numbers, the O1 backfill (27/27 Specs built, 0 failed, peak 514 MiB) and the start-up worker check.
- **Precision:** `pnpm bench --json --concurrency 1` on `main` `d725125`, twice, 18:50–19:02. GitHub code search was rate-limited (HTTP 403) during both runs, so that Discovery source was skipped.

| Run | Resolved | FR | Outcome accuracy | long-tail coverage | p50 | p90 |
|---|---|---|---|---|---|---|
| O4 #1 | 20 | 1 (Fly.io) | 77.5% | 72.7% | 9.8 s | 14.8 s |
| O4 #2 | 20 | 2 (Fly.io, Box) | 80.0% | 72.7% | 9.5 s | 14.5 s |
| Earlier the same afternoon, `main` without WTR-106 | 17–19 | 1 (Box) | 70–75% | 72.7% | 11.4–17.0 s | 24.2–27.6 s |

The afternoon runs were slower because the external services were degraded, not because of Slice 4. A run of WTR-106 and a run without it were equally slow. By the evening, latency was back to Slice 3's level.

## The two False Resolutions (label questions for Wes)

- **Box:** the Lookup returned `https://raw.githubusercontent.com/box/box-openapi/main/openapi/openapi.json`. It is byte-identical to the listed `…/main/openapi.json`.
- **Fly.io Machines API:** the Lookup returned `https://docs.fly.io/machines-api/openapi.json`, on Fly's own docs domain. The listed `https://docs.machines.dev/openapi.json` has the same API, title, version (`1.0`), servers and 70 paths. The two files differ in one description's docs link. The docs.fly.io copy is newer: modified 2026-09-23, against 2026-09-22 (checked 2026-09-23 19:03). In Slice 3, Fly.io answered NoSpec under the 9 s deadline. It resolves now.

Neither URL has been added to `benchmark/entries.json`.

## What was built

| Issue | What |
|---|---|
| WTR-104, 112 | `src/spec-forms/`: Normalized Form, Validity Issues and Spec Outline with Scalar; `allowReserved` dropped where 3.1 forbids it |
| WTR-105, 116, 117 | `spec_forms` table, background build worker and backfill; a 75 min reference budget; retries go behind untried Specs; aborted fetches release their host slot |
| WTR-106 | The Outcome carries download URLs, the Normalized Form's status and real Validity Issues |
| WTR-107 | Download routes; one shared app and per-IP gate |
| WTR-108, 109, 110 | `GET /api/apis/{apiId}/outline`, `…/operation`, `GET /api/vendors/{vendor}/apis` |
| WTR-111 | `scripts/formscheck.ts` |
| WTR-119 | The workers start when the server boots (found in production: they waited for the first request) |
| WTR-120 | Operations written as a `$ref` are inlined in the Normalized Form (found in production on DigitalOcean) |

## Known misses and follow-ups

- **DigitalOcean** was rebuilt after WTR-120 deployed. The result is recorded in [`docs/deploy.md`](../deploy.md). Its Normalized Form still has 62 findings (from a clone of `main`): 60 from response `headers` maps written as a `$ref`, and 2 tag descriptions that aren't strings as published. Whether to normalize those is open.
- **Stored forms aren't rebuilt when the builder changes.** DigitalOcean's row was deleted by hand. Rebuilding stored forms after a builder change is an open decision.
- **`list_vendor_apis` by name can't match anything yet.** Every Vendor in the Index is stored with `name` equal to its id (`stripe.com`), so `/api/vendors/Stripe/apis` is 404. Lookup by id, domain or URL works.
- **Stripe's large operations come back truncated** at the 1 MB cap. That was all 5 operations sampled, `GET /v1/account` included. A Caller follows the `x-truncated` refs through the Normalized Form. This is the decided behaviour, and for Stripe it is the common case.
- The `get_operation` cache holds a parsed Normalized Form until another Spec replaces it, so a rebuilt Spec's parse stays stale until then.
- No Swagger 2 Spec is in the Index, so conversion is proven on fixtures only.
- Other Benchmark misses in both O4 runs: Slack is Unconfirmed; Loops is Ambiguous; Mux, Zoho and Intuit are NoSpec; Atlassian and Cisco are Unknown. All of these were already in Slice 3's list. Steam is Ambiguous in run 1 only. **Dropbox API answers Unknown where NoSpec is expected, in both runs.** That is not in Slice 3's list; it wasn't investigated. WTR-101 is still awaiting Wes.
