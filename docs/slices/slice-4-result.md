# Slice 4 result: Spec forms and navigation

**Acceptance** ([backlog](slice-4-backlog.md)): the Normalized Form (with Swagger 2 → OpenAPI conversion and bundling), Validity Issues, download URLs for both forms, `get_spec_outline`, `get_operation` and `list_vendor_apis` work on the largest Benchmark Specs without timeouts. This is measured in production by `scripts/formscheck.ts` on GitHub, Stripe and Cloudflare. Nothing may cost what Slice 3 bought: False Resolution stays < 2% on `pnpm bench`, and Discovery p90 stays < 15 s.

**Accepted by Wes, 2026-09-23.** Forms, navigation, Discovery and False Resolution pass. False Resolution passes with the two Benchmark label additions Wes accepted (below). The follow-ups are #14–#18 in the [backlog](slice-4-backlog.md), with WTR-101.

| Condition | Target | Measured | |
|---|---|---|---|
| Forms and navigation on GitHub, Stripe and Cloudflare | no timeouts | `formscheck` **PASS** twice: 18:48 (outline p90 150 ms, operation p90 347 ms) and **22:14 after the queue drained, on Cloudflare's new Current Spec `d2436b88`** (outline p90 179 ms, operation p90 293 ms, 0 non-2xx). Downloads ≤ 0.5 s (26.1 MB) | pass |
| Outline p90 | < 500 ms | 150 ms; 179 ms | pass |
| Operation p90 | < 2 s | 347 ms; 293 ms | pass |
| Discovery (production `loadcheck --only discovery`) | p90 < 15 s | **p90 13.7 s** (p50 8.7 s, max 16.5 s; 40/40, 0 errors, 0 429s) | pass |
| False Resolution (`pnpm bench --concurrency 1`, twice) | < 2% | **0/20 and 0/20**, re-scored with the two accepted labels. Scored before them: 1/20 and 2/20. Each was the Vendor's own Spec at a URL `specSources` didn't list | pass |
| Index answers during the backfill | p90 < 200 ms (ADR 0004) | **p90 80 ms** (p50 63 ms, max 207 ms) | pass |

## How it was measured

- **Production:** image `30d7ebf` for `formscheck` (18:48 CDT) and `d725125` for Discovery (19:03), both 2026-09-23. They ran from WOPR3 through Cloudflare, with the load-check key. [`docs/deploy.md`](../deploy.md) has the per-name numbers, the O1 backfill (27/27 Specs built, 0 failed, peak 514 MiB) and the start-up worker check.
- **Precision:** `pnpm bench --json --concurrency 1` on `main` `d725125`, twice, 18:50–19:02. GitHub code search was rate-limited (HTTP 403) during both runs, so that Discovery source was skipped.

| Run | Resolved | FR | Outcome accuracy | long-tail coverage | p50 | p90 |
|---|---|---|---|---|---|---|
| O4 #1 | 20 | 0 (1 before the labels: Fly.io) | 77.5% | 81.8% (72.7% before) | 9.8 s | 14.8 s |
| O4 #2 | 20 | 0 (2 before the labels: Fly.io, Box) | 80.0% | 81.8% (72.7% before) | 9.5 s | 14.5 s |
| Earlier the same afternoon, `main` without WTR-106 | 17–19 | 1 (Box) | 70–75% | 72.7% | 11.4–17.0 s | 24.2–27.6 s |

The O4 rows are re-scored: the saved JSON reports go through `score()` (`src/benchmark/score.ts`) with the current `benchmark/entries.json` (2026-09-23 22:14). No Lookup was re-run. Before re-scoring, all 37 production Specs' forms were `ready` (22:13).

The afternoon runs were slower because the external services were degraded, not because of Slice 4. A run of WTR-106 and a run without it were equally slow. By the evening, latency was back to Slice 3's level.

## The two False Resolutions (labels accepted by Wes, 2026-09-23)

- **Box:** the Lookup returned `https://raw.githubusercontent.com/box/box-openapi/main/openapi/openapi.json`. It is byte-identical to the listed `…/main/openapi.json`.
- **Fly.io Machines API:** the Lookup returned `https://docs.fly.io/machines-api/openapi.json`, on Fly's own docs domain. The listed `https://docs.machines.dev/openapi.json` has the same API, title, version (`1.0`), servers and 70 paths. The two files differ in one description's docs link. The docs.fly.io copy is newer: modified 2026-09-23, against 2026-09-22 (checked 2026-09-23 19:03). In Slice 3, Fly.io answered NoSpec under the 9 s deadline. It resolves now.

Both URLs are now in their entries' `specSources` in `benchmark/entries.json`. Checked again at 22:14: the two Box files have the same sha256 (`0f8794ed…`). The two Fly.io files have the same title, version, servers and 70 paths.

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

## Known misses and follow-ups (Wes's decisions, 2026-09-23)

- **One slow Spec holds up every other Spec's forms.** The worker builds one Spec at a time, and DigitalOcean's references take ~50 min to fetch. On 2026-09-23 at 19:44, a changed DigitalOcean Spec held up Cloudflare's new Current Spec and five others until ~20:35. **Decided:** a second lane for Specs with same-origin external references (backlog #14). Defer keeping fetched reference files across builds until a second DigitalOcean-like Spec appears. Don't serve the previous Spec's forms. WTR-101 (Slice 3's add-on guard) is scheduled with #14.
- **Stored forms aren't rebuilt when the builder changes.** DigitalOcean's row was deleted by hand after WTR-120. **Decided:** a `builder_version` in `spec_forms`, with the old forms served during a rebuild (#15, after #14).
- **`list_vendor_apis` by name can't match anything yet.** Every Vendor is stored with `name` equal to its id, so `/api/vendors/Stripe/apis` is 404. **Decided:** match through the names the Index remembers (`api_names`), then by the Vendor id's brand label (#16). Vendor display names aren't filled in.
- **DigitalOcean's leftover findings.** After WTR-120, production's build has 2 normalized findings, down from 697. Upstream `main` built from a clone has 62: 60 from response `headers` maps written as a `$ref`, and 2 tag descriptions that aren't strings. **Decided:** inline a `$ref` written where a map belongs (#17). The 2 tag descriptions stay: they're the Vendor's defect, reported as Validity Issues.
- **Stripe's large operations come back truncated** at the 1 MB cap (all 5 sampled, `GET /v1/account` included). **Decided:** keep it, as designed. Callers follow the `x-truncated` refs. Revisit only if Slice 5's MCP users struggle.
- **Dropbox API answers Unknown where NoSpec is expected** (both O4 runs). **Investigated** (22:15; three traced Lookups, all Unknown): Dropbox now redirects `www.dropbox.com/developers/documentation` to `docs.dropboxapi.com`. `followPortals` takes the final domain, so the Candidate's Vendor becomes `dropboxapi.com`, and the Judge scores it 0.64–0.68, under `apiPick` 0.7. The redirect is new on Dropbox's side; it isn't Judge variance. Fix: #18.
- The `get_operation` cache holds a parsed Normalized Form until another Spec replaces it, so a rebuilt Spec's parse stays stale until then.
- No Swagger 2 Spec is in the Index, so conversion is proven on fixtures only.
- Other Benchmark misses in both O4 runs: Slack is Unconfirmed; Loops is Ambiguous; Mux, Zoho and Intuit are NoSpec; Atlassian and Cisco are Unknown. All of these were already in Slice 3's list. Steam is Ambiguous in run 1 only.
