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

| # | Linear | Issue | Depends on | Wave |
|---|---|---|---|---|
| 1 | | Time each Lookup step, and report latency percentiles in the Benchmark | — | 1 |
| 2 | | A production server and container: Nitro, Dockerfile, Litestream to B2 | — | 1 |
| 3 | | API keys: table, hashing and `scripts/keys.ts` | — | 1 |
| 4 | | Stale entries, background Verification and `fresh: true` | 3 (migration order) | 2 |
| 5 | | The HTTP gate: per-IP rate limit, API keys for Discovery, daily quotas | 3, 4 | 3 |
| 6 | | `scripts/loadcheck.ts`: p90 against a deployed URL | 1, 5 | 4 |
| 7 | — | Speed up Discovery | 1 | filed after #1's numbers |

#3 and #4 both add a Drizzle migration, so #4 waits for #3 to avoid two `0004_*` files. #4 and #5 both touch the Lookup's entry point (`lookup.ts`, `http.ts`), so they're queued in waves, not together.

**#7 is not filed yet.** Once #1 merges, run `pnpm bench --json --concurrency 1` live and see where the seconds go. Then file one issue for each change the numbers justify (running steps concurrently, tighter budgets, skipping a step once an earlier one has settled). Each must keep False Resolution < 2%.

## Operator steps (not factory issues)

These are done by hand with Wes's OK, following `docs/deploy.md`, which is written as they're done:

- **O1.** Create a private B2 bucket `swaggerbot-litestream`, plus an application key restricted to that bucket.
- **O2.** Create a Coolify app on `coolify.8gnc.com` from `evolv3ai/swaggerbot`, built from the Dockerfile (#2). Give it a persistent local volume at `/app/data`, and put the env vars in Coolify's secrets.
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
