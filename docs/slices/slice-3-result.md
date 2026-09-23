# Slice 3 result: Live service

**Acceptance** ([PRD](../PRD.md#slice-3--live-service)): in production, answers from the Index hit p90 < 200 ms, Discovery hits p90 < 15 s, and a restore from the backup has been done. Precision must hold: False Resolution < 2%.

**All three conditions are met. Slice 3 ACCEPTED by Wes, 2026-09-23.**

| Condition | Target | Measured in production | |
|---|---|---|---|
| Index answers | p90 < 200 ms | **p90 80 ms** (p50 66, max 116; 95 requests) | pass |
| Discovery | p90 < 15 s | **p90 14.2 s** (p50 9.5, max 17.0) and **12.3 s** (p50 7.6, max 14.8); 40 requests each | pass |
| Restore from backup | done | rehearsed against the production replica: row counts identical, same Lookup answer ([`docs/deploy.md`](../deploy.md), O5) | pass |
| False Resolution | < 2% | **0/20 and 0/20** (`pnpm bench --concurrency 1`, 9 s deadline) | pass |

## How it was measured

- **Production:** `scripts/loadcheck.ts https://swaggerbot.dev` (WTR-93), run from WOPR3 through Cloudflare to the Coolify server `cbo-01-217-110`, image `b7c880b`. The Discovery phase sends one `fresh: true` Lookup per Benchmark entry, one at a time, with the load-check key `key_qyg4vkdz`. The Index phase runs 5 rounds, without a key, over the names Discovery resolved, paced under the per-IP limit. There were no errors and no 429s. The second run was Discovery only.
- **Precision:** `pnpm bench --json --concurrency 1` on WTR-96's final branch, twice with the default 9 s Spec-step deadline and once with `SPEC_STEP_BUDGET_MS=Infinity`. The numbers are in [`slice-3-backlog.md`](slice-3-backlog.md), under "Where Discovery's time goes".

## How Discovery got from p90 46 s to 14 s

| Stage | p50 | p90 | FR | long-tail coverage |
|---|---|---|---|---|
| Start of Slice 3 (WTR-88's timings) | 19.4 s | 46.3 s | 1/21 (Box) | 90.9% |
| WTR-94: probe stops 3 s after its first hit | 7.1 s | 45.8 s | 0/22 | 100% |
| WTR-95: Box's full Spec always reaches the pool | — | — | Box 5/5 live | — |
| WTR-96: Spec sources in parallel, 9 s deadline (after two reworks) | 9.3–9.5 s | 14.4–14.6 s | 0/20, 0/20 | 81.8% |

The deadline costs Mux and Fly.io, which answer NoSpec because their Specs are only found late (Wes accepted this, 2026-09-23). Long-tail coverage stays well above Slice 2's 60% gate. With `SPEC_STEP_BUDGET_MS=Infinity`, every entry answers as it did after WTR-94.

## What was built

WTR-88 (step timings), 89 (Nitro server, Dockerfile, Litestream to B2), 90 (API keys), 91 (Stale entries, background Verification, `fresh`), 92 (per-IP rate limit, keys for Discovery, daily quotas), 93 (load check), 94, 95, 96 (Discovery speed and precision), 97 (Verification keeps the Caller's spelling) and 98 (the keys CLI in the image). Operator steps O1–O6 are recorded in [`docs/deploy.md`](../deploy.md).

## Known misses and follow-ups

- **WTR-101** (Backlog, awaiting Wes): the add-on guard also holds back full Specs whose URL names a version. Twilio Verify, DigitalOcean and Jira take about 10 s instead of 1–2 s, and Plaid takes 15–17 s, the slowest production Discovery.
- Mux and Fly.io are NoSpec under the deadline (accepted).
- Carried from Slice 2: Atlassian and Cisco answer Unknown where Ambiguous is expected, Zoho and Intuit answer NoSpec, Steam answers Ambiguous, and Slack answers Unconfirmed. Loops' Judge score sits right at its threshold.
- The app needs its API keys even to serve Index answers (`docs/deploy.md`, O5 gotcha).
- A spacing test in `src/fetch/fetcher.test.ts` is flaky under load.
