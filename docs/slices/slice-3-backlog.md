# Slice 3 backlog: Live service

The issues for [Slice 3](../PRD.md#slice-3--live-service), written so the weawr factory can build them: each numbered body is filed as-is on Linear (team WTR, labels `ai` + `swaggerbot`). Capitalised terms are from [`CONTEXT.md`](../../CONTEXT.md). Conventions shared by every issue live in `.weawr/instructions.md`.

**Acceptance:** in production, answers from the Index hit p90 < 200 ms, Discovery hits p90 < 15 s, and a restore from the backup has been done. Precision must hold: False Resolution stays < 2% on `pnpm bench`.

## Decisions going in (Wes, 2026-09-22)

- **Server:** the Coolify instance at `coolify.8gnc.com`. **Domain:** `swaggerbot.dev` (apex).
- **Backups go to Backblaze B2, not R2.** Litestream writes to B2 through B2's S3-compatible endpoint; ADR 0002 is amended to match.
- **API keys** are issued by the operator with a CLI (`scripts/keys.ts`) and stored hashed in the Index database. Quotas to start with: 100 Discovery or `fresh` Lookups per key per UTC day, and 60 requests a minute per IP for everything.
- **"p90 in production"** is measured by a load-check script (`scripts/loadcheck.ts`) run against the deployed URL.
- **Discovery latency:** measure first, then speed it up, keeping the 15 s target.
- **Infrastructure is the operator's job, not the factory's.** The factory builds the code (#1–#7). The B2 bucket, Coolify app, DNS, secrets, deploy and restore rehearsal are done by hand, following [`docs/deploy.md`](../deploy.md) (the Operator steps below).

## Where it stands going in

Slice 2 is accepted (`69392d9`): False Resolution 0/22 and 0/21, long-tail coverage 100% and 90.9%.

**Discovery is far off its latency target.** These are single Lookups on an empty Index, run one at a time on 2026-09-22: Stripe 6.7 s, Neon 6.8 s, Loops 23.2 s, Val Town 24.5 s, Asana 50.2 s and Render 57.5 s. Four of the six are over 15 s. The step budgets alone explain some of it: the known-path probe has 25 s and the crawl step 20 s. There's no per-step timing yet, so #1 measures before anything is changed.

**Nothing serves the app yet.** `pnpm build` produces `dist/server/server.js`, which exports a fetch handler; no Node server runs it. `fresh` is accepted by `POST /api/lookup` and ignored (see the `LookupRequest` doc comment). There is no auth, quota or rate limit, and nothing marks an entry Stale.

## Order

Filed 2026-09-22 as WTR-88..93 (Backlog, `swaggerbot` only), with Linear "blocked by" relations mirroring this table.

| # | Linear | Issue | Depends on | Wave |
|---|---|---|---|---|
| 1 | WTR-88 | Time each Lookup step, and report latency percentiles in the Benchmark | — | 1 |
| 2 | WTR-89 | A production server and container: Nitro, Dockerfile, Litestream to B2 | — | 1 |
| 3 | WTR-90 | API keys: table, hashing and `scripts/keys.ts` | — | 1 |
| 4 | WTR-91 | Stale entries, background Verification and `fresh: true` | 3 (migration order) | 2 |
| 5 | WTR-92 | The HTTP gate: per-IP rate limit, API keys for Discovery, daily quotas | 3, 4 | 3 |
| 6 | WTR-93 | `scripts/loadcheck.ts`: p90 against a deployed URL | 1, 5 | 4 |
| 7 | — | Speed up Discovery | 1 | filed after #1's numbers |
| 7a | WTR-94 | The known-path probe stops soon after its first hit | 1 | 5 |
| 7bc | WTR-96 | The Spec step's sources run in parallel, within one deadline | 7a | 6 |
| 9 | WTR-97 | Verification uses the Caller's spelling, not the normalised name | 4 | 5 |
| 11 | WTR-101 | The add-on guard holds back only likely add-ons | 7bc | 7 |
| 10 | WTR-98 | The keys CLI runs in the production image | 3 | 5 |
| 8 | WTR-95 | Box: the full Spec sometimes never reaches the pool, and an add-on answers | — | 5 |

#3 and #4 both add a Drizzle migration, so #4 waits for #3 to avoid two `0004_*` files. #4 and #5 both touch the Lookup's entry point (`lookup.ts`, `http.ts`), so they're queued in waves, not together.

**#7 is not filed yet.** Once #1 merges, run `pnpm bench --json --concurrency 1` live and see where the seconds go. Then file one issue for each change the numbers justify (running steps concurrently, tighter budgets, skipping a step once an earlier one has settled). Each must keep False Resolution < 2%.

### Where Discovery's time goes (measured 2026-09-23, WTR-88's branch)

`pnpm bench --json --concurrency 1`, fresh Index, 40 entries: **p50 19.4 s, p90 46.3 s, max 59.9 s.** False Resolution was 1/21 (Box's `box-openapi-v2025.0.json`, the intermittent miss known since Slice 2 round 3; WTR-88 only adds timers). Long-tail coverage was 90.9%.

Seconds summed over the run, by step: known paths 431 s (22 Lookups, mean 19.6 s), Developer Portal crawl 197 s (14, mean 14.1 s), Developer Portal search 99 s (26, mean 3.8 s), GitHub code search 69 s (10, mean 6.9 s). Everything else together is under 55 s. Judge calls average 0.2–0.3 s.

- **The known-path probe takes 15–25 s even when it finds the Spec.** It probes the 11 host prefixes in parallel, but each host walks all 15 paths at the fetcher's 1 s per-host spacing (about 16 s), and it doesn't stop on a hit. WTR-42 chose that deliberately: an old copy on `docs.` may answer before the current Spec on another host. Neon took 14.8 s, Loops 16.8 s and Val Town 16.3 s. Replicate, Cloudflare and Supabase hit the 25 s cap with the Spec already found. Of the 14 Resolved answers that reached this stage, the probe settled 8, the crawl 4 and GitHub code search 2.
- **The Spec sources run one after another.** Known paths, then the crawl, then GitHub, each only if nothing is settled yet. So NoSpec answers pay for all three: Render 56 s, Codeberg 54 s, Zoho 46 s, Dropbox 43 s, Reddit 40 s.
- **Developer Portal search spends 1–7 s before any of that.** So to meet p90 < 15 s, the Spec step has roughly 8–10 s for most names.

### Speed-up options (for Wes to choose; each must keep False Resolution < 2%)

- **7a. Stop the probe early, breadth-first.** Try the likeliest paths (`/openapi.json`, `/openapi.yaml`, `/swagger.json`) on every host first. Once any host yields a Spec, give the other hosts a short grace period (for example 3 s) to finish those likeliest paths, then stop. That keeps the "stale copy on `docs.`" guard for the common paths, and should bring the 8 probe wins from 15–25 s down to about 3–6 s.
- **7b. Run the three Spec sources at the same time**, then weigh their hits in today's order (known paths, then crawl, then GitHub), so the precedence and precision rules don't change. The wall time becomes the slowest of the three instead of their sum.
- **7c. A deadline for the whole Spec step** (for example 9 s), answering from what has been found by then. This is what bounds NoSpec answers. It costs coverage wherever a Spec is only found late: Mux's crawl took 16 s, and Fly.io's 20 s.
- **7d. Less politeness spacing for known-path probes only** (for example 250 ms instead of 1 s). The PRD asks for a rate limit per host, not a number. This is the bluntest lever.

**Wes, 2026-09-23: 7a now** (issue 7a below). **7b, 7c and 7d are to be decided after 7a is measured.** He also asked for Box's intermittent False Resolution to be filed now (issue 8).

**Wes, 2026-09-23 (after 7a): 7b + 7c, keeping 15 s.** They're filed as one issue (7bc below), because both reshape the same code. The deadline is a setting, and `Infinity` gives 7b alone, so one build can be measured both ways.

**7a measured (WTR-94, merged `b900308`; bench on its branch, concurrency 1, 2026-09-23):** Discovery **p50 19.4 s → 7.1 s**; p90 46.3 s → 45.8 s; max 59.6 s. False Resolution 0/22, long-tail coverage 100%, Outcome accuracy 85%. The six probe wins now spend 4.0–4.8 s in the probe (were 15–25 s): Supabase 27.9 → 6.3 s total, Cloudflare 27.8 → 7.1 s, Neon 21.1 → 9.8 s. **14 of 40 Lookups are still over 15 s**, and they are the NoSpec names and the late finds: Mailchimp 59.6 s, Codeberg 53.5 s, Asana 49.4 s, Mux 46.3 s, Zoho 45.8 s, Slack 45.4 s, Dropbox 42.4 s, Reddit 40.0 s, Fly.io 34.1 s and Intuit 32.2 s. Each of them pays the probe's 25 s budget with no hit, **plus** the crawl's 20 s, plus GitHub. To reach p90 < 15 s, at most 4 of 40 may be over.

- **With 7b**, each of these costs its slowest source, not the sum of all three: roughly 25–30 s for the NoSpec names (the probe's 25 s with no hit, plus about 3–5 s of Developer Portal search). That's still over 15 s.
- **With 7b and 7c** (a Spec-step deadline of about 9 s), nearly all fall under about 15 s. The late finds are lost: Mux (crawl 16 s) and Fly.io (crawl 12.9 s) would answer NoSpec. That is 2 of 11 long-tail entries, so coverage would be about 82%, still over the 60% gate. Asana stays, because GitHub finds it in about 2 s once it runs in parallel.

**WTR-96, first build (PR #55, 2026-09-23), sent back for rework.** `bench --concurrency 1`, run both ways:

| | p50 | p90 | max | FR | long-tail coverage |
|---|---|---|---|---|---|
| after WTR-94 (baseline) | 7.1 s | 45.8 s | 59.6 s | 0/22 | 100% |
| WTR-96, 9 s deadline | 11.0 s | 15.5 s | 16.3 s | 0/18 | 81.8% |
| WTR-96, `Infinity` | 18.2 s | 29.7 s | 32.6 s | 0/20 | 81.8% |

What had to change:
1. Nothing was judged until every source had finished or the deadline passed. Neon's known paths had its Spec at 3.6 s, but the Lookup took 15.5 s (it was 9.8 s after WTR-94).
2. GitHub's gather waited for the crawl's orgs. It took 14–27 s in parallel, against 2–10 s sequentially, so the deadline cut it off and Box and Asana fell to Unconfirmed.
3. Mux answered NoSpec even without a deadline: the crawl stopped finding its Spec.

The rework note asks for sources to be judged in precedence order as each finishes (stopping once one settles), for GitHub not to wait on the crawl, and for a fix to Mux's crawl.

**WTR-96 rework 1 (`03682ef`), sent back again.** Sources are now judged as they finish, GitHub no longer waits on the crawl, and the probe yields to the crawl on a shared host.

| | p50 | p90 | max | FR | long-tail coverage |
|---|---|---|---|---|---|
| 9 s deadline | 8.9 s | **14.5 s** | 15.3 s | **1/18** (Box, via GitHub's add-on) | 72.7% |
| `Infinity` | 9.2 s | 29.7 s | 31.2 s | 0/20 | 90.9% |

Box and Asana are Resolved again. But the yielding starves the probe on the crawl's own host: Cloudflare answered NoSpec in both runs, and Supabase with the deadline. Rework 2 asks for:
- the probe's likeliest paths to go ahead of the crawl's requests, with only the rest yielding (the per-host politeness is unchanged);
- a Judge-rejected hit not to start the probe's grace window;
- the WTR-95 guard: a Lookup isn't settled while every confirmed Spec's URL names an API Version.

**WTR-96 rework 2 (`50d78a6`), merged as `b7c880b`.** The probe's likeliest paths go ahead of the crawl on a shared host; a stub hit (under 5 paths) starts no grace window; a Lookup isn't settled while every confirmed Spec's URL names an API Version.

| | p50 | p90 | max | FR | long-tail coverage |
|---|---|---|---|---|---|
| 9 s deadline, run 1 | 9.5 s | **14.6 s** | 15.3 s | **0/20** | 81.8% |
| 9 s deadline, run 2 | 9.3 s | **14.4 s** | 15.8 s | **0/20** | 81.8% |
| `Infinity` | 9.6 s | 30.5 s | 31.1 s | 0/22 | 100% |

The probe wins are back: Supabase 5.8–6.2 s, Cloudflare 6.7–6.8 s, Neon 9.5–9.9 s. Box and Asana are Resolved. With the deadline, only Mux and Fly.io are lost (the accepted cost); without it, every entry answers as it did after WTR-94.

**The known cost (issue 11):** the add-on guard also holds back legitimate Specs whose URL names a version. Twilio Verify (`…verify_v2.json`), DigitalOcean (`…public.v2.yaml`) and Jira (`swagger-v3.v3.json`) went from 1–2 s to about 10 s, and Plaid (`2020-09-14.yml`) from 6.5 s to 15.3 s.

7a and 7b don't trade anything away. 7c is the only one that bounds the worst case, and it's the one that costs coverage. A rough estimate: 7a and 7b together bring p50 under 10 s but leave the p90 around 20–25 s, because of the NoSpec names. Reaching p90 < 15 s very likely needs 7c too.


## Operator steps (not factory issues)

These are done by hand with Wes's OK, following `docs/deploy.md`, which is written as they're done:

- **O1.** (done 2026-09-23) Create a private B2 bucket `swaggerbot-litestream`, plus an application key restricted to that bucket.
- **O2.** (done 2026-09-23, not deployed) Create a Coolify app on `coolify.8gnc.com` from `evolv3ai/swaggerbot`, built from the Dockerfile (#2). Give it a persistent local volume at `/app/data`, and put the env vars in Coolify's secrets.
- **O3.** Point `swaggerbot.dev` at the Coolify server and have the app answer there with TLS.
- **O4.** Do the first deploy, check `/api/health`, and issue one key for the load check.
- **O5.** **Rehearse a restore.** Restore the B2 replica into a scratch path, compare row counts and a Lookup answer against the live database, then restore into a fresh volume and boot the app from it. Record it in `docs/deploy.md`.
- **O6.** Run `scripts/loadcheck.ts` against `https://swaggerbot.dev` and record the numbers in `docs/slices/slice-3-result.md`.

---

## 1. swaggerbot: time each Lookup step, and report latency percentiles in the Benchmark

## Problem
Discovery must answer in p90 < 15 s in production (PRD, Slice 3). Single live Lookups on an empty Index on 2026-09-22 took 6.7 s (Stripe) to 57.5 s (Render), with four of six over 15 s. Nobody knows where the time goes. The Benchmark already times each answer (`BenchmarkAnswer.ms` in `src/benchmark/run.ts`), but it reports no percentiles, and nothing times the steps inside a Lookup. Speeding anything up before measuring it would be guessing.

## Change
**Step timings.** In `src/lookup/lookup.ts`, record how long each step of a Discovery takes. The steps are the Index, APIs.guru, the umbrella check, `whichApi`, the Developer Portal search, the known-path probe, the Developer Portal crawl (including its off-host probes), GitHub code search, the Vendor-API crawl, and fetching and judging the Specs. Use the step names the code already uses in comments and diagnostics. A step that runs more than once in a Lookup adds up its time.
- Add an optional `timings?: Record<string, number>` (milliseconds, rounded) to the Outcome, **only when `deps.trace` is on** (`LOOKUP_TRACE=1`), so production answers don't change shape. Put it on the Outcome type in `src/domain/outcome.ts` as an optional field that every variant allows, with a doc comment saying it's diagnostic.
- Time a step with a small helper, e.g. `timed(name, fn)`, rather than scattering `performance.now()` through `lookup`. A step that throws still records its time.

**Benchmark report.**
- `BenchmarkReport` (in `src/benchmark/score.ts`) gains `latency: { count, p50, p90, max }` in ms over the answers' `ms`. With the default fresh Index every answer is a Discovery; with `--index <path>` some come from the Index, and the printed line says so rather than splitting them. Use the nearest-rank method for percentiles, in an exported function (e.g. `percentile(values, p)` in `src/benchmark/latency.ts`) so it can be tested and reused by #6.
- `scripts/bench.ts` prints a latency line under the header, e.g. `Latency (Discovery): p50 9.8 s · p90 31.2 s · max 57.5 s (n=40)`. It already sets `LOOKUP_TRACE=1` for the Lookup it builds, so every answer in `--json` will carry `timings`.
- A `--concurrency <n>` flag (default 4, as now) passes through to `runBenchmark`. `--concurrency 1` measures latency without Lookups competing for the fetcher's per-host spacing. Add it to the flag parsing in `src/benchmark/cli.ts`, validated like the other flags (a positive integer, or exit 2).

`README.md`: in the `pnpm bench` section, mention the latency line, `--concurrency`, and that `--json` answers carry step `timings`.

## Done when
- `src/benchmark/score.test.ts`: the percentile function's nearest-rank results on known arrays (empty, one value, ten values), and a report built from answers with `ms` carries `latency`.
- `src/benchmark/cli.test.ts`: `--concurrency 0`, `--concurrency x` exit 2, and `--concurrency 2` parses.
- `src/lookup/lookup.test.ts`: with `trace: true`, a Discovery that goes through APIs.guru to a Resolved answer carries `timings` with at least the APIs.guru step. Without `trace`, there's no `timings` key.
- In the PR description, describe as a manual check (for the reviewer, who has keys): `pnpm bench --json --concurrency 1` shows the latency line and per-answer `timings`.
- `pnpm check` and `pnpm build` green.

---

## 2. swaggerbot: a production server and container — Nitro, Dockerfile, Litestream to B2

## Problem
swagger.bot is to run as one container on Coolify, with the Index in SQLite on a persistent volume, replicated continuously with Litestream (ADR 0002). The replica goes to Backblaze B2 through its S3-compatible API. Today `pnpm build` produces only `dist/server/server.js`, a fetch handler with no Node server around it. There is no `start` script, no Dockerfile and no Litestream config.

## Change
**Node server.** Follow TanStack Start's hosting guide for Node: add the `nitro` dependency and the `nitro()` plugin from `nitro/vite` to `vite.config.ts`, after `tanstackStart()` and before `viteReact()`. `pnpm build` should then produce `.output/`. Add `"start": "node .output/server/index.mjs"`. Check that `better-sqlite3`, a native module, ends up usable from `.output`. If Nitro doesn't trace it into `.output/server/node_modules`, configure it as external, and say in the PR what you did. `.output/` is already in `.gitignore`. It listens on `PORT` (default 3000).

`openDb` applies migrations from `./drizzle`, relative to the working directory, so the runtime needs the `drizzle/` folder next to where it starts.

**Dockerfile** (repo root), multi-stage, on `node:24-slim`:
- The build stage runs `corepack enable`, `pnpm install --frozen-lockfile` and `pnpm build`. It needs the tools `better-sqlite3` builds with (`python3`, `make`, `g++`) if no prebuilt binary matches.
- The runtime stage has `WORKDIR /app` and copies `.output/`, `drizzle/`, `docker/entrypoint.sh` and `docker/litestream.yml`. It installs the Litestream **v0.5.x** binary from its GitHub release (pin the exact version with an `ARG`, for the image's architecture: amd64 and arm64 both work). It sets `ENV DATABASE_PATH=/app/data/swaggerbot.db`, declares `VOLUME /app/data`, runs as a non-root user that owns `/app/data`, and has `EXPOSE 3000`. A `HEALTHCHECK` fetches `/api/health`.
- Add a `.dockerignore` (node_modules, .output, dist, data, .env*, .git).

**Litestream** (`docker/litestream.yml`). There's one database, `${DATABASE_PATH}`, with one replica: `type: s3`, `bucket: ${LITESTREAM_BUCKET}`, `path: ${LITESTREAM_PATH}` (default `swaggerbot`), `endpoint: ${LITESTREAM_ENDPOINT}` (B2's is `s3.<region>.backblazeb2.com`), and credentials from `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY`. Litestream expands `${VAR}` in its config.

**Entrypoint** (`docker/entrypoint.sh`, `set -eu`):
- If `LITESTREAM_BUCKET` is unset, it prints one line saying replication is off and `exec`s `node .output/server/index.mjs`. That way the image runs locally with no backups configured.
- Otherwise it runs `litestream restore -config /app/docker/litestream.yml -if-db-not-exists -if-replica-exists "$DATABASE_PATH"`, so a fresh volume starts from the backup, then `exec litestream replicate -config … -exec "node .output/server/index.mjs"`, so Litestream supervises the app and stops when it stops.

**README.md**: a "Running in production" section covering `pnpm build && pnpm start`, the image (`docker build -t swaggerbot .`; `docker run -p 3000:3000 -v swaggerbot-data:/app/data --env-file .env swaggerbot`), the env vars above, and that replication is off without `LITESTREAM_BUCKET`.

Don't add a CI workflow, compose files or anything Coolify-specific; the operator sets up Coolify.

## Done when
- `pnpm build` produces `.output/server/index.mjs`, and `pnpm start` (with `DATABASE_PATH` pointing at a temp file) answers `GET /api/health` with `{"ok":true}`. Show this in the PR description.
- If Docker is available in your environment: `docker build` succeeds, and the container started without `LITESTREAM_BUCKET` answers `/api/health` and has the migrated database at `/app/data/swaggerbot.db`. If Docker isn't available, say so in the PR; the reviewer will run it.
- `shellcheck docker/entrypoint.sh` is clean, if `shellcheck` is available.
- `pnpm check` and `pnpm build` green.

---

## 3. swaggerbot: API keys — table, hashing and `scripts/keys.ts`

## Problem
Discovery and `fresh: true` need an identified Caller with a daily quota (PRD "Access"; `CONTEXT.md`, Discovery). There are no keys yet. For Slice 3 the operator issues them by hand; self-service sign-in is "Later" in the PRD. This issue builds the storage and the CLI. Enforcing them over HTTP is #5.

## Change
**Schema** (`src/index-store/schema.ts`, and a new Drizzle migration generated with `drizzle-kit generate`):
- `api_keys`: `id` (text PK, a short random id such as `key_` + 8 base32 chars, safe to show), `owner` (text, not null, who it was issued to), `key_hash` (text, unique, lowercase hex sha256 of the secret), `daily_quota` (integer, nullable; null means the default), `created_at`, and `revoked_at` (nullable).
- `api_key_usage`: `key_id` (FK), `day` (text `YYYY-MM-DD`, UTC) and `count` (integer). PK is (`key_id`, `day`).

**Repo** (`src/index-store/keys.ts`, beside `repo.ts`, taking the same `Db`):
- `createKey(owner, dailyQuota?) → { id, secret }`. The secret is `sb_` + 32 random bytes in base64url (`node:crypto`). Only its hash is stored, and the secret is returned once.
- `findKey(secret) → key | undefined`, by hash. A revoked key is not found.
- `revokeKey(id)`, `listKeys()` (never with hashes or secrets).
- `useQuota(keyId, day, limit) → { allowed: boolean; used: number; limit: number }`: atomically adds one to the day's count **only if** it's below `limit`, in one SQL statement (an upsert with a `WHERE count < limit` guard, or a transaction).
- `DEFAULT_DAILY_QUOTA = 100`, overridable by the env var `DAILY_QUOTA`. A key's own `daily_quota` wins over both.

**CLI** (`scripts/keys.ts`, run as `pnpm tsx scripts/keys.ts …`, opening the Index at `DATABASE_PATH` like the other scripts):
- `create <owner> [--quota N]` prints the id and the secret, with a line saying the secret isn't stored and can't be shown again.
- `list` prints id, owner, quota, created, revoked, and today's usage.
- `revoke <id>`.
- A bad command or missing argument prints usage and exits 2.
Put the argument parsing in a pure, exported function so it's testable, as `src/benchmark/cli.ts` does for the Benchmark.

`README.md`: a short "API keys" section on issuing, listing and revoking keys.

## Done when
- `src/index-store/keys.test.ts`, on a temp database:
  - a created secret is found by `findKey`, and the stored row holds no secret;
  - a revoked key isn't found;
  - `useQuota` allows exactly `limit` uses in a day, then refuses, and a new day starts at zero;
  - a key's own quota beats the default.
- A test for the CLI's argument parsing (bad command and missing owner both exit 2).
- The migration is generated, not hand-written, and applies on an existing Index (`openDb` on a database from before it).
- `pnpm check` and `pnpm build` green.

---

## 4. swaggerbot: Stale entries, background Verification and `fresh: true`

## Problem
PRD "Index and Verification": an Index entry older than the freshness window is Stale. A Stale entry is still returned and queues a background Verification, `fresh: true` waits for a live Verification instead, and every answer carries `verifiedAt`. Today `answerFromIndex` in `src/lookup/lookup.ts` returns what's stored regardless of age, and `fresh` is ignored (see the `LookupRequest.fresh` doc comment). ADR 0002: background Verification runs in-process, queued in a SQLite table.

## Change
**What a Verification is.** Verification means confirming against the live web that a Source still serves its Spec and that the Current Spec is still current (`CONTEXT.md`). Discovery already does this for the entries it touches: it re-fetches the Sources, `addSource(…, at)` moves `lastVerifiedAt`, and a Spec whose Sources all stopped serving it is Superseded. So **a Verification is a Discovery of the same name that skips step 1 (the Index)**. Don't write a second pipeline. Add `skipIndex?: boolean` to the options the `lookup` function takes internally, or restructure so step 1 can be bypassed. A cheaper check that re-fetches only the stored Source URLs is out of scope; mention it in the PR description if you think it's worth an issue.

**Stale.** An answer from the Index is Stale when its `verifiedAt` is older than the freshness window. The window is `FRESHNESS_DAYS`, default 7 (the PRD's starting assumption). Keep it in `src/lookup/thresholds.ts` or beside `answerFromIndex`, read once from the env in `createAppLookup`, and allow a `LookupDeps` override for tests. Use `deps.now`.

**Queue** (new table and a Drizzle migration generated after #3's): `verifications` with `name_normalized` (PK, one row per name), `requested_at`, `started_at` (nullable), `finished_at` (nullable), `attempts` (integer) and `last_error` (nullable). Queueing a name that already has an unfinished row does nothing. Queueing a name whose last Verification finished within the window also does nothing.

**Worker** (`src/lookup/verify.ts`): `createVerifier({ db, lookup, now? })` returns `{ enqueue(name), runOnce(): Promise<boolean>, start(), stop() }`.
- `runOnce` claims the oldest unstarted row, runs the Lookup with `skipIndex`, and marks it finished. On a throw it records `last_error`, bumps `attempts`, and requeues until 3 attempts.
- `start()` polls `runOnce` one row at a time. When the queue is empty it waits 5 s between polls. The timer is `unref`ed so it never keeps the process alive, and `stop()` ends it.
- On start, rows left `started_at` without `finished_at` (the process died mid-run) are requeued.

**Lookup.**
- When `answerFromIndex` answers and the answer is Stale, the Lookup queues a Verification for that name and returns the stored answer at once. That's the fast path; don't await anything.
- With `fresh: true`, the Lookup skips the Index and runs Discovery (that is, a Verification) and returns its answer.
- Update the `fresh` doc comment.

**App.** `createAppLookup` builds the verifier over the same Lookup and starts it. Expose it (e.g. return `{ lookup, verifier }` from a new `createApp`, keeping `createAppLookup` for `pnpm bench` and the scripts, which must **not** start a worker). The `/api/lookup` route uses the started one.

Don't touch auth or quotas; that's #5. `fresh: true` works for everyone after this issue, and #5 gates it.

## Done when
- `src/lookup/lookup.test.ts`, with `now` injected and fixtures as in the existing tests:
  - an entry verified within the window answers from the Index and queues nothing;
  - an entry older than the window answers from the Index **and** queues a Verification;
  - `fresh: true` on an indexed name runs Discovery (the fake APIs.guru is called) and moves `verifiedAt`.
- `src/lookup/verify.test.ts`: `runOnce` on a queued name runs the Lookup with `skipIndex` and marks the row finished. A throwing Lookup is retried up to 3 attempts. A duplicate `enqueue` is a no-op. Interrupted rows are requeued on start.
- `README.md`: a sentence each on the freshness window (`FRESHNESS_DAYS`) and `fresh: true`.
- `pnpm check` and `pnpm build` green.

---

## 5. swaggerbot: the HTTP gate — per-IP rate limit, API keys for Discovery, daily quotas

## Problem
PRD "Access": answers from the Index are open to anyone, with a rate limit per IP. Discovery and `fresh: true` need an API key with a daily quota. #3 built keys and quotas, and #4 built `fresh` and Verification. `POST /api/lookup` (`src/routes/api/lookup.ts` → `handleLookupRequest` in `src/lookup/http.ts`) enforces none of it.

## Change
**Split the Lookup at the Index.** The handler has to know whether a request can be answered from the Index before it decides whether a key is needed. Expose that from the Lookup. For example, give the value `createLookup` returns a `fromIndex(request): Outcome | null` method using the same `answerFromIndex` logic, including queueing a Stale entry's Verification. Keep calls of `lookup(request)` working unchanged, so `pnpm bench`, `scripts/lookup.ts` and the tests don't need edits beyond types.

**`handleLookupRequest`**, in this order:
1. **Rate limit per IP.** Use an in-memory token bucket, `RATE_LIMIT_PER_MINUTE` (default 60), keyed by client IP. There's one instance (ADR 0002), so memory is enough. Evict idle buckets so the map can't grow forever. The client IP is the first address in the header named by `CLIENT_IP_HEADER` (default `x-forwarded-for`, which Coolify's proxy sets); without one, use `"unknown"`. Over the limit, return **429** with `Retry-After` and `{ error: "Rate limit exceeded." }`.
2. Parse the body as now (400s unchanged).
3. **Key.** Read `Authorization: Bearer <secret>`. If a key is presented and `findKey` doesn't know it, return **401** `{ error: "Unknown or revoked API key." }`, even when the Index could have answered, so a bad key is never silently ignored.
4. Without `fresh`, if `fromIndex` answers, return **200** with it. No key and no quota are used.
5. Otherwise (Discovery, or `fresh: true`):
   - with no key, return **401** `{ error: "Discovery needs an API key.", … }`, with a short hint about how to get one;
   - otherwise `useQuota` for today (UTC). If it's refused, return **429** `{ error: "Daily quota used.", limit, used }` with `Retry-After` set to the seconds until UTC midnight;
   - otherwise run the Lookup and return 200. Add `X-Quota-Limit` and `X-Quota-Remaining` headers.

`useQuota` (WTR-90) trips Biome's React `useHookAtTopLevel` rule when it's called inside a `try` or a branch. Renaming it to `takeQuota` across `src/index-store/keys.ts`, its tests and this handler is allowed and preferred.

Keep the rate limiter and the gate as small pure-ish units with injected clocks (`src/lookup/rate-limit.ts`, and the gate in `http.ts`), so they're testable without a server.

`README.md`: an "Access" section covering what's open, what needs a key, the header, the limits and their env vars, and the status codes.

## Done when
- `src/lookup/rate-limit.test.ts`: allows the limit and refuses the next one with the right retry seconds, refills over time (injected clock), keeps IPs separate, and evicts idle buckets.
- `src/lookup/http.test.ts` (new, or extend `src/routes/api/lookup.test.ts`), with a fake Lookup and a temp-database key store:
  - an indexed name without a key → 200, with no quota used;
  - an unindexed name without a key → 401;
  - `fresh: true` without a key → 401;
  - an unknown key on an indexed name → 401;
  - a valid key → 200 with the quota headers, and quota + 1 in a day → 429;
  - the per-IP limit → 429 with `Retry-After`;
  - the IP comes from `CLIENT_IP_HEADER`.
- `pnpm check` and `pnpm build` green.

---

## 6. swaggerbot: `scripts/loadcheck.ts` — p90 against a deployed URL

## Problem
Slice 3 is accepted on latencies measured **in production**: Index answers p90 < 200 ms and Discovery p90 < 15 s. `pnpm bench` measures the Lookup in-process, not the deployed service behind its proxy. A script is needed that measures the real thing through `POST /api/lookup`, respecting the service's own limits (#5).

## Change
`scripts/loadcheck.ts <baseUrl> [--key <secret> | env LOADCHECK_KEY] [--only discovery|index] [--rounds N] [--rps R] [--json]`:
- **Discovery phase** (needs a key): for each Benchmark entry (`benchmark/entries.json`, loaded with the existing entry loader in `src/benchmark/entry.ts`), send one `POST /api/lookup` with `fresh: true`, **one at a time** so each Lookup is measured on its own. Record wall-clock ms and the Outcome. This also fills the production Index for the next phase. It uses one quota unit per entry (40 today), so say so in `--help` and make sure the key's quota covers it.
- **Index phase** (no key): `--rounds` rounds (default 5) over the names the Discovery phase answered Resolved (or, with `--only index`, every Benchmark name, skipping any that come back 401). Pace requests at `--rps` (default 0.8, under the default 60/min per-IP limit) and send them without a key, the way an anonymous Caller would. Record ms.
- Report each phase's count, p50, p90 and max (reuse `percentile` from `src/benchmark/latency.ts`, added by #1), the error and 429 counts, and **PASS/FAIL against 200 ms and 15 s**. Exit 1 if either phase fails its target, and 2 on bad arguments.
- `--json` prints the whole report, with every request's name, phase, ms, HTTP status and Outcome kind.

Put the argument parsing and the report arithmetic in pure exported functions. The network loop stays thin.

`README.md`: a line under the Benchmark section on how to run it against a deployment.

## Done when
- A unit test for the argument parsing (unknown flag, bad `--rps`, missing URL → exit 2) and for the PASS/FAIL arithmetic on known timings.
- A test that runs the script's main loop against a local `node:http` server on port 0, which fakes `/api/lookup` with fixed delays. The report counts the phases and 429s correctly. No real service is called.
- `pnpm check` and `pnpm build` green.

---

## 7a. swaggerbot: the known-path probe stops soon after its first hit

## Problem
The known-path probe (`probeKnownPaths` in `src/fetch/known-paths.ts`) is the step that most often finds the Spec, and the slowest. `pnpm bench --concurrency 1` on 2026-09-23 (the "Where Discovery's time goes" section of `docs/slices/slice-3-backlog.md`) shows it takes 15–25 s **even when it finds the Spec**: Neon 14.8 s, Loops 16.8 s, Val Town 16.3 s, and Replicate, Cloudflare and Supabase all at the 25 s budget with the Spec already in hand.

The reason: every host prefix is probed in parallel, but each host walks the whole `KNOWN_PATHS` list at the fetcher's 1 s per-host spacing (about 16 s), and nothing stops the probe when a Spec turns up. Since the hosts run in parallel and the list is ordered likeliest first, a Spec at `/openapi.json` is usually in hand within about 2 s. Everything after that is waiting. Discovery must reach p90 < 15 s (PRD, Slice 3).

WTR-42 deliberately keeps every hit rather than the first one: a stale copy on one host (`docs.`) can answer before the current Spec on another. That guard must survive in a bounded form.

## Change
In `src/fetch/known-paths.ts`:
- `ProbeOptions` gains `graceAfterHitMs` (default `DEFAULT_GRACE_AFTER_HIT_MS = 3000`). When the first hit is collected, the probe's deadline becomes the earlier of the existing budget and "now + grace". When it passes, every host stops, exactly as the budget stops them today. Hits collected before the stop are kept (the existing `collect` behaviour).
- `graceAfterHitMs: 0` stops at the first hit, and `Infinity` keeps today's behaviour. Document both on the option.
- Nothing else changes: host prefixes, the path list and its order, the per-host sequencing, `robots.txt` handling, the `apis.json` following, dead-host short-circuiting and the dedupe by URL.

Callers in `src/lookup/lookup.ts` (the known-path step, and the crawl step's off-host probes) keep the default. Don't change them beyond what the type needs.

## Done when
- `src/fetch/known-paths.test.ts`, against the existing fixture server:
  - A host with a Spec at its first path while another host hangs: the probe returns that Spec within about `graceAfterHitMs` plus a margin, not the budget. Use small numbers (for example, a 200 ms grace and a 5 s budget).
  - A second Spec on another host, found inside the grace window, is also returned.
  - A second Spec that would only be found after the grace window is not returned.
  - With no hits, the probe still runs until the budget, or until every host finishes.
  - `graceAfterHitMs: Infinity` reproduces today's results on the existing cases.
- In the PR description, describe as a manual check for the reviewer (who has keys) a `pnpm bench --json --concurrency 1` run. In it, the `known paths` step time for Neon, Loops, Val Town, Replicate, Cloudflare and Supabase drops to about 6 s or less, False Resolution stays < 2%, and long-tail coverage stays ≥ 60%.
- `pnpm check` and `pnpm build` green.

---

## 8. swaggerbot: Box — the full Spec sometimes never reaches the pool, and an add-on answers

## Problem
`Box Platform API` intermittently resolves to `https://developer.box.com/box-openapi-v2025.0.json`: API Version 2025.0, 24 paths, one of Box's per-version add-on files. Its full Spec is `https://developer.box.com/box-openapi.json` (2024.0, 187 paths; labelled in `benchmark/entries.json`). It's a False Resolution, and on its own it takes the Benchmark over the 2% gate (1/21 on 2026-09-23). It has been intermittent since Slice 2 round 3.

Two live Lookups on 2026-09-23, each on a fresh Index with `LOOKUP_TRACE=1`, both had `crawl from https://box.com (3 found)`:
- **Right:** `pool: …/box-openapi.json (2024.0, 187 paths, Judge 0.98)`, `pool: …/box-openapi-v2025.0.json (2025.0, 24 paths, Judge 0.93)`, `not in pool: …/box-openapi-v2026.0.json (2026.0, 5 paths, Judge 0.79)`. Current 2024.0: correct.
- **Wrong:** `pool: …/box-openapi-v2025.0.json (24 paths, Judge 0.94)`, `pool: …/box-openapi-v2026.0.json (5 paths, Judge 0.82)`. **`box-openapi.json` doesn't appear at all**, not even as "not in pool". No `crawl fetch failed` diagnostic appeared either (WTR-86 reports those). Current 2025.0: wrong. Because a Spec was confirmed, the Lookup counts as settled, and GitHub code search, which would find `box/box-openapi/openapi.json`, never runs.

So one of the three crawl hits sometimes vanishes between the crawl and the pool, silently. WTR-58's rule (a per-version add-on isn't Current over the full Spec) can only work when the full Spec is in the pool.

## Change
1. **Find where the third hit goes**, in `src/sources/crawl.ts` (the crawl's result) and in the crawl step and `consider`/pool code of `src/lookup/lookup.ts`. Possible causes include a fetch that fails without a diagnostic, a timeout or budget cut inside the crawl step (it took about 10 s both times), a Judge error swallowed as "not a Spec", and a dedupe keyed wrongly. Whatever the cause, a crawl hit that doesn't reach the pool must leave a diagnostic that says why. Add that even if the root cause turns out to be elsewhere.
2. **Fix the cause.** If it's a transient fetch or Judge failure, retry once, as WTR-86 does for Spec fetches.
3. **Don't add a speculative guard.** If, once you've found the cause, you see a narrow rule that would also have stopped the add-on from answering (for example, keep searching when the only confirmed Specs are ones whose URL names an API Version), propose it in the PR description with the evidence. Don't build it in this issue.

## Done when
- A test reproduces the silent drop with fakes (a crawl result of three Specs where one can't be fetched or judged): the diagnostic appears, and the answer isn't the add-on.
- In the PR description, as a manual check for the reviewer (who has keys): `LOOKUP_TRACE=1 pnpm tsx scripts/lookup.ts "Box Platform API"` with a fresh `DATABASE_PATH` five times. All five answer Current 2024.0 (`box-openapi.json` or the GitHub `openapi.json`).
- `pnpm check` and `pnpm build` green.

---

## 9. swaggerbot: Verification uses the Caller's spelling, not the normalised name

## Problem
WTR-91 keys the `verifications` queue on `name_normalized`, and the worker runs Discovery with that normalised string (`"PayCo API"` → `"payco"`). The Judge (`whichApi`, `specDescribesApi`) and web search then see different input from the Lookup that first resolved the name. On a borderline name, a background Verification could reach a different API or Outcome than the original Lookup. Precision is the release gate, so a Verification must ask exactly what a Caller asked.

## Change
- The `verifications` table gains a `name` column (text, not null): the spelling from the Lookup that queued it. Generate the migration with `drizzle-kit generate`. Rows from before the column get `name = name_normalized`.
- `enqueue(name)` stores the Caller's spelling. Re-queueing an existing row updates `name` to the latest spelling.
- `runOnce` runs the Lookup with `name`, not `name_normalized`. The queue stays keyed on `name_normalized`, so there's still one row per name.

## Done when
- `src/lookup/verify.test.ts`: enqueueing `"PayCo API"` makes the worker run the Lookup with `"PayCo API"`. A second enqueue with another spelling of the same normalised name updates the stored spelling and doesn't add a row.
- The migration applies to an Index that already has queued rows.
- `pnpm check` and `pnpm build` green.

---

## 7bc. swaggerbot: the Spec step's sources run in parallel, within one deadline

## Problem
Discovery must answer in p90 < 15 s (PRD, Slice 3). After WTR-94, `pnpm bench --concurrency 1` gives p50 7.1 s but p90 45.8 s: 14 of 40 Lookups take over 15 s (see "Where Discovery's time goes" and "7a measured" in `docs/slices/slice-3-backlog.md`). They're the names where the Spec step's sources in `findSpec` (`src/lookup/lookup.ts`) all run to the end, **one after another**:

```
if (!settled()) await timed("known paths", knownPathsStep);          // up to 25 s
if (!settled()) await timed("Developer Portal crawl", crawlStep);    // up to 20 s
if (!settled() && githubSearch) await timed("GitHub code search", …); // 2–15 s
```

For example, Codeberg takes 15 + 20 + 15 s, Mailchimp 25 + 20 + 8 s, Asana 25 + 20 + 2 s, and Mux 25 + 16 s.

Wes decided (2026-09-23) to run these three sources in parallel **and** to bound them with one deadline, keeping the 15 s target. He accepts that a Spec found only after the deadline is lost; Mux and Fly.io are the known cases.

## Change
**Split each source into gathering and judging.** Today each step fetches and calls `consider` (Judge) in one loop, and stops early with `settled()`/`goOn`. Change the three steps so each first **gathers** its candidate Specs (URL, bytes, sniff, provenance and the `consider` options it passes today, e.g. `offHost`, `robotsDisallowed`) without judging them, then run the three gathers **concurrently**. Once they're all done, or the deadline passes, **judge in today's order**: known-path hits, then crawl hits (on-host before off-host, as now), then GitHub hits (in their `areSpecLinks` ranking). Apply today's per-source rules unchanged while judging: known-path and crawl hits are all considered (WTR-42, WTR-95), and `goOn` applies where it applies today. The precedence, and so the Current Spec, must come out the same as today whenever a source finishes in time.
- **The Spec fetch step** (APIs.guru origin URLs) stays **first and sequential**, as now. It's fast and often settles the Lookup (Stripe, GitHub, OpenAI). The parallel sources start only if it didn't. The APIs.guru mirror fallback stays last.
- **Known paths:** `probe(choice.vendor.domain, { allowBlanketRobots: true, budgetMs })`, with the remaining time as the budget.
- **Crawl:** `crawl({ startUrl, api })` bounded by the remaining time (pass a budget or signal into `crawlForSpecs` if it needs one; today its own cap is 20 s). Its off-host known-path probes run inside the crawl's gather, within the same deadline. They can no longer stop on `settled()` (nothing is judged yet), so probe every off-host host in parallel rather than one by one.
- **GitHub:** it starts at once with the orgs it knows without the crawl. When the crawl's gather ends before the deadline and reports `githubOrgs` it hasn't searched, it searches those too. After `areSpecLinks`, it fetches at most the top `MAX_GITHUB_SPEC_FETCHES` (3) ranked hits during the gather, since it can no longer stop at the first that settles.

**The deadline.** `SPEC_STEP_BUDGET_MS`, default **9000**, in `src/lookup/thresholds.ts`, overridable by the `SPEC_STEP_BUDGET_MS` env var (read in `createAppLookup`/`createApp`) and by `LookupDeps`. It bounds the three gathers together, from the moment they start. What each source has gathered by then is judged, and the rest is dropped. Leave the diagnostic `spec step deadline: <sources still running> stopped after <ms> ms`. `Infinity` means no deadline, which is 7b alone, so a reviewer can measure both. Judging after the deadline isn't bounded, since it's cheap (about 0.2–0.3 s a call).

**Timings.** WTR-88's `timings` keep one entry per source, now each source's gather time, plus a new `Spec judging` step for the judging phase.

`README.md`: a line on `SPEC_STEP_BUDGET_MS` in the configuration section.

## Done when
- `src/lookup/lookup.test.ts`, with fakes:
  - **Parallel:** a fake probe, crawl and GitHub search that each take 300 ms finish the Spec step in well under 900 ms. Assert on elapsed time with a generous margin, or use fake timers.
  - **Precedence:** when known paths and GitHub both offer a confirmed Spec, the answer is the same as today's sequential order would give.
  - **Deadline:** a crawl that would return its Spec after the deadline is dropped, the answer is the known-path hit (or NoSpec), and the `spec step deadline` diagnostic names the crawl.
  - **`Infinity`:** the late crawl hit is kept.
  - **GitHub orgs from the crawl:** an org reported by a crawl that finishes before the deadline is searched.
  - The existing Box (WTR-95), PagerDuty and Mux/Fly-style tests still pass. Where one depends on sequential early stopping, adapt it and say why in the PR.
- In the PR description, describe as a manual check for the reviewer (who has keys) two `pnpm bench --json --concurrency 1` runs, one with the default and one with `SPEC_STEP_BUDGET_MS=Infinity`. Expected with the default: p90 < 15 s, False Resolution < 2%, long-tail coverage ≥ 60%. Mux and Fly.io may become NoSpec.
- `pnpm check` and `pnpm build` green.

---

## 10. swaggerbot: the keys CLI runs in the production image

## Problem
The operator issues API keys with `scripts/keys.ts` (WTR-90). The production image (WTR-89's `Dockerfile`) ships only `.output/`, `drizzle/` and `docker/`: there's no `scripts/`, no `src/` and no `tsx`. So `docker exec <container> pnpm tsx scripts/keys.ts …` can't run. The first production key (2026-09-23) had to be inserted with hand-written SQL (`docs/deploy.md`, O4). Keys must be issued against the live Index on the container's volume, so the CLI has to run inside the container.

## Change
- Build the keys CLI into a standalone ESM file during `pnpm build`, e.g. `.output/cli/keys.mjs`. One way is an extra Vite/Rollup entry, or a small `tsup`/`esbuild` step if that's simpler (a dev dependency is fine). It should use the same `src/index-store/keys.ts` and `keys-cli.ts` code, with `better-sqlite3` resolved from `.output/server/node_modules` (or bundled so it resolves at run time).
- Copy it into the runtime image, so this works: `docker exec <container> node .output/cli/keys.mjs create <owner> [--quota N]`, plus `list` and `revoke`. It opens `DATABASE_PATH`, which the image sets.
- `README.md` ("API keys") and `docs/deploy.md`: the production command.

## Done when
- After `pnpm build`, `DATABASE_PATH=<tmp> node .output/cli/keys.mjs create x` then `list` works outside the repo's `node_modules` (e.g. copy `.output` elsewhere and run it there). Show it in the PR.
- If Docker is available, the same inside the built image. Otherwise say so and the reviewer checks it on the server.
- `pnpm check` and `pnpm build` green.

---

## 11. swaggerbot: the add-on guard holds back only likely add-ons

## Problem
WTR-96 added a guard (from WTR-95's proposal): a Lookup isn't settled while every confirmed Spec's URL names an API Version, because Box's per-version add-on (`openapi-v2025.0.json`, 24 paths) could otherwise answer before the full `box-openapi.json` (187 paths). The guard works for Box. But it also holds back full Specs whose URL just happens to name a version, so they wait out the whole 9 s Spec-step deadline. `pnpm bench --concurrency 1` on 2026-09-23, after WTR-94 and after WTR-96:
- Twilio Verify, `…/twilio_verify_v2.json`: 1.0 s → 10.2 s
- DigitalOcean, `…/DigitalOcean-public.v2.yaml`: 1.2 s → 10.2 s
- Jira, `…/swagger-v3.v3.json`: 1.8 s → 10.7 s
- Plaid, `…/2020-09-14.yml`: 6.5 s → 15.3 s (over the 15 s target on its own)

## Change
Narrow the guard in `src/lookup/lookup.ts` so that a confirmed Spec with a versioned URL counts as a **possible add-on** only when its shape says so, not its URL alone. Treat it as settled (as before WTR-96) unless one of these holds:
- its path count is under `ADD_ON_MAX_PATHS` (new in `src/lookup/thresholds.ts`, default 40); Box's add-ons have 24 and 5 paths, while the four Specs above have hundreds;
- or the same Source already listed, or the Index already holds for this API, a sibling Spec with many more paths.

Keep everything else about WTR-96 unchanged. Explain the chosen threshold in the PR against the numbers above.

## Done when
- `src/lookup/lookup.test.ts`: a versioned-URL Spec with 300 paths settles at once (no waiting for later Sources). Box's shape (a 24-path versioned add-on from GitHub first, the full Spec from the crawl later) still answers the full Spec. The existing WTR-96 guard tests still pass.
- In the PR description, as a manual check for the reviewer (who has keys): `pnpm bench --json --concurrency 1`. Twilio Verify, DigitalOcean and Jira are back to about 2 s, Plaid to about 7 s, Box is still Resolved to its full Spec, False Resolution < 2%, p90 < 15 s.
- `pnpm check` and `pnpm build` green.
