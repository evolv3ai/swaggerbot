<img src="swaggerbot-logo-bw.svg" alt="swagger.bot logo" width="96" height="96">

# swagger.bot

swagger.bot turns the name of an API into a verified OpenAPI/Swagger Spec with its Provenance, or says honestly why it can't. It is a single TanStack Start app (HTTP API, MCP endpoint and web UI) with the Index in SQLite. See [`docs/PRD.md`](docs/PRD.md) for what it does and why, [`CONTEXT.md`](CONTEXT.md) for the glossary and [`docs/adr/`](docs/adr/) for the decisions behind it.

## Install

Requires Node 24 and pnpm (the version is pinned in `package.json`; `corepack enable` picks it up).

```sh
pnpm install
cp .env.example .env   # fill in the keys you need
```

The Index database lives at `DATABASE_PATH` (default `./data/swaggerbot.db`); its directory is created on first open.

## Run

```sh
pnpm dev     # dev server; GET /api/health returns {"ok":true}
pnpm build   # production build into .output/
```

## Running in production

`pnpm build` produces a Node server in `.output/` (TanStack Start on [Nitro](https://nitro.build)); `pnpm start` runs it. It listens on `PORT` (default 3000) and opens the Index at start-up, applying migrations from `./drizzle`, so start it from the repository root (or anywhere with `drizzle/` beside `.output/`).

```sh
pnpm build && pnpm start
```

In production it runs as one container ([ADR 0002](docs/adr/0002-single-instance-tanstack-start-with-sqlite.md), [`docs/deploy.md`](docs/deploy.md)):

```sh
docker build -t swaggerbot .
docker run -p 3000:3000 -v swaggerbot-data:/app/data --env-file .env swaggerbot
```

The image keeps the Index at `DATABASE_PATH=/app/data/swaggerbot.db` on the `/app/data` volume and checks `GET /api/health`. [Litestream](https://litestream.io) replicates the Index continuously to Backblaze B2 through its S3-compatible API (`docker/litestream.yml`), configured by these env vars:

| Variable | Meaning |
|---|---|
| `LITESTREAM_BUCKET` | The B2 bucket. Without it, replication is off: the container says so in one line and runs the app alone. |
| `LITESTREAM_PATH` | The replica's path in the bucket (default `swaggerbot`). |
| `LITESTREAM_ENDPOINT` | B2's S3 endpoint, `s3.<region>.backblazeb2.com`. |
| `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY` | A B2 application key restricted to the bucket. |

With `LITESTREAM_BUCKET` set, the entrypoint (`docker/entrypoint.sh`) first restores the Index from the replica when the volume has no database yet, then runs the app under `litestream replicate`, which stops when the app stops. The app's own keys (`TYPESAFE_API_KEY` and the rest in `.env.example`) are passed the same way.

## Benchmark

```sh
pnpm bench [--only-reviewed] [--json] [--search brave|tavily] [--concurrency <n>]
```

Runs every Benchmark entry through the live Lookup and prints the False Resolution rate, long-tail coverage and Outcome accuracy; it exits 1 when the False Resolution rate reaches the 2% gate. It needs the same keys as a Lookup (`TYPESAFE_API_KEY`, plus a search key for portal finding).

A run uses a throwaway Index by default: a fresh, empty database in a temporary directory, deleted when the run ends. Without it, names the Index had already settled would be answered from the Index, and the Benchmark would measure Index replay instead of Discovery. Two flags change this:

- `--index <path>` uses the Index at that path and never deletes it, for comparing runs or inspecting what was stored.
- `--keep-index` keeps the temporary Index and prints its path.

They can't be used together. The report names the Index it used (`indexPath` and `indexFresh` in `--json`).

Under the header a latency line gives the p50, p90 and max time per answer, e.g. `Latency (Discovery): p50 9.8 s · p90 31.2 s · max 57.5 s (n=40)` (`latency` in `--json`, in ms). With a fresh Index every answer is a Discovery; with `--index`, some came from the Index, and the line says so. `--concurrency <n>` runs n Lookups at once (default 4); `--concurrency 1` measures latency without Lookups competing for the fetcher's per-host spacing. The run traces each Lookup (`LOOKUP_TRACE=1`), so in `--json` every answer's Outcome carries `timings`: milliseconds per Lookup step (`APIs.guru`, `Judge whichApi`, `Developer Portal search`, `known paths`, `Developer Portal crawl`, `GitHub code search`, `Spec fetch`, `Spec judging` and so on), a step that ran more than once adding up.

The Spec step's three Sources (known paths, the Developer Portal crawl, GitHub code search) gather at once and are judged in that order as each ends, so a known-path Spec answers without waiting for the others. What a Source hasn't gathered after `SPEC_STEP_BUDGET_MS` (default 9000 ms) is dropped, with a `spec step deadline` diagnostic. `SPEC_STEP_BUDGET_MS=Infinity` turns the deadline off, to measure what it costs.

To measure a deployment instead, run `LOADCHECK_KEY=<secret> pnpm tsx scripts/loadcheck.ts https://swaggerbot.dev`: it sends each Benchmark name through `POST /api/lookup` as a fresh Discovery (one quota unit each, so the key's quota must cover every entry), then rounds of keyless Index answers paced under the rate limit, and prints each phase's p50, p90 and max with PASS/FAIL against Discovery p90 < 15 s and Index p90 < 200 ms (exit 1 on a FAIL; `--only index` needs no key; `--help` for the rest).

## Freshness and Verification

Every answer says when its Spec was last verified (`verifiedAt`). An answer from the Index verified longer ago than the freshness window, `FRESHNESS_DAYS` (default 7), is Stale: it is still returned at once, and a background Verification of the name is queued in the Index (`verifications`) and run by the server, one at a time, as a Discovery that skips the Index. A Lookup with `fresh: true` skips the Index itself and waits for that live Verification instead.

## Spec forms

Each Spec's Normalized Form (bundled and converted to OpenAPI 3.1), its Validity Issues and its Spec Outline are built in the background and stored in the Index (`spec_forms`, [ADR 0004](docs/adr/0004-normalized-form-built-in-background-with-scalar.md)): the server builds one Spec at a time, oldest first (a Spec being retried after a failed attempt goes behind every Spec not yet tried), so a Lookup never waits for a build, and a Spec stored before the table existed is built the same way. External `$ref`s on the Spec's own origin are fetched through the polite fetcher, behind any Lookup's requests to the same host, within 75 min per Spec; a build whose references don't all arrive in that time counts as a failed attempt rather than being saved. A build is retried up to three times, then given up (`failed`). A Published Form over `MAX_FORMS_BYTES` (in bytes, default 32 MB) is never built, to keep a build's memory within the container; a value that is not a positive integer is ignored with a warning.

A Resolved or Unconfirmed Outcome gives each of its Specs (`currentSpec` and each of `alternateSpecs`, or `spec`) with two more fields:

- `downloads`: `{ "published", "normalized" }`, the URLs of its Published Form and Normalized Form, `${PUBLIC_BASE_URL}/api/specs/{specId}/published` and `…/normalized`. Set `PUBLIC_BASE_URL` to the public origin with no trailing slash (`https://swaggerbot.dev`); without it the URLs are paths starting with `/api/`.
- `normalized`: whether its Normalized Form is `ready`, still `pending` (the background build hasn't reached it) or `failed`.

Beside them, the Outcome carries the Validity Issues of the Spec it answers with (the Current Spec, or the Unconfirmed Spec): `validityIssues`, at most 50 groups `{ message, path, count }` with the largest `count` first, and `validityIssueCount`, the total count of findings. Both are empty (`[]`, 0) while the Spec's forms are pending.

`GET /api/apis/{apiId}/operation?method=get&path=/v1/customers/{customer}[&specId=…]` (`get_operation`) returns one operation of the API's Current Spec (or of its Spec `specId`), open to anyone under the per-IP rate limit. `method` is any case; `path` must equal a key of the Normalized Form's `paths`, URL-encoded. The answer is `{ apiId, specId, method, path, operation, circular, securitySchemes, truncated }`: the operation with its Path Item's parameters merged in and its effective `security`, every `$ref` it reaches inlined. A schema that recurs within itself stays `{ "$ref", "x-circular": true }` and is listed once in `circular`. Answers are capped at 1 MB, expanded breadth-first: past the cap, what's left is `{ "$ref", "x-truncated": true }` and `truncated` is `true`. 400 without `method` or `path`, 404 for an unknown API, Spec or operation, 409 (`Retry-After: 10`) while the Spec's forms are pending and 422 when they failed.

To check the forms and the navigation on a deployment, run `pnpm tsx scripts/formscheck.ts https://swaggerbot.dev` (`--names GitHub,Stripe,Cloudflare` by default, `--json` for the whole report, `--help` for the rest). For each name it sends `POST /api/lookup` (an Index answer; set `LOADCHECK_KEY` to send it as the bearer, so a name missing from the Index is found by a Discovery, one quota unit each), which must be Resolved; if the Current Spec's forms are `pending`, it asks the outline every 5 s for up to 2 minutes. Then it downloads both forms from the Outcome's `downloads` (the Published bytes' sha256 must be the Spec id, the Normalized Form JSON with `openapi` 3.1.x), GETs the outline, 5 of its operations (the first, the last and 3 evenly spaced between them) and `GET /api/vendors/{vendorId}/apis`, which must list the API. Requests are paced under the default 60/min per-IP limit, and a 429 is retried after its `retry-after`. It prints each request's time and size, the outline and operation p90s and any non-2xx answer, and exits 0 when every step succeeded, outline p90 < 500 ms, operation p90 < 2 s and every download finished within 60 s; otherwise it exits 1, naming what failed.

## Access

`POST /api/lookup` takes `{ "name", "apiVersion"?, "allowCommunity"?, "fresh"? }`.

- **Open to anyone:** a name the Index already answers, without `fresh`. It uses no key and no quota.
- **Needs an API key:** Discovery (a name the Index can't answer) and `fresh: true`. Send the key as `Authorization: Bearer <secret>`. Each such Lookup uses one unit of the key's daily quota, counted per UTC day (see [API keys](#api-keys)); the response carries `X-Quota-Limit` and `X-Quota-Remaining`. A key sent with an Index answer is still checked, so a wrong one is never silently ignored, but no quota is used.
- **Every request** counts against a per-IP rate limit, a token bucket of `RATE_LIMIT_PER_MINUTE` requests a minute (default 60), kept in memory. The client IP is the first address in the header named by `CLIENT_IP_HEADER` (default `x-forwarded-for`; `cf-connecting-ip` behind Cloudflare); without the header, all such requests share one bucket.

| Status | When |
|---|---|
| 200 | The Outcome, from the Index or from a Lookup. |
| 400 | The body isn't JSON or isn't a valid lookup request (`issues` says why). |
| 401 | `Unknown or revoked API key.` (a key was sent that isn't live), or `Discovery needs an API key.` (none was sent and the Index can't answer, or `fresh: true`). |
| 405 | Any method but `POST`, with `Allow: POST`. |
| 429 | `Rate limit exceeded.` for the IP, or `Daily quota used.` with `limit` and `used` for the key. `Retry-After` gives the seconds to wait: until a request is allowed again, or until UTC midnight. |

Every API route answers a method it doesn't take with 405 and an `Allow` header, and a path under `/api/` that no route serves with a JSON 404, never the web page.

## API keys

Discovery and `fresh` Lookups need an API key, each with a daily quota counted per UTC day. The operator issues keys by hand, in the Index at `DATABASE_PATH`:

```sh
pnpm tsx scripts/keys.ts create "<owner>" [--quota N]   # prints the key's id and secret
pnpm tsx scripts/keys.ts list                            # id, owner, quota, created, revoked, today's usage
pnpm tsx scripts/keys.ts revoke <id>
```

In production the image has no `scripts/` or `tsx`. `pnpm build` bundles the same CLI into `.output/cli/keys.mjs`, which the image carries, so run it in the container, against the Index on its volume:

```sh
docker exec <container> node .output/cli/keys.mjs create "<owner>" [--quota N]
docker exec <container> node .output/cli/keys.mjs list
docker exec <container> node .output/cli/keys.mjs revoke <id>
```

Only the secret's sha256 is stored, so `create` is the one time it is shown: hand it to its owner then. The id (`key_…`) is safe to show and is what `list` and `revoke` use. A key without `--quota` gets the default, 100 a day, or `DAILY_QUOTA` when that is set; a key's own quota wins over both. A revoked key stays in the list but is no longer accepted.

## MCP

swagger.bot is also an MCP server, for agents: `https://swaggerbot.dev/mcp`, Streamable HTTP, stateless (`@modelcontextprotocol/server` 2.1.0, [ADR 0005](docs/adr/0005-mcp-in-process-with-agent-sized-results.md)). Add it to Claude Code with:

```sh
claude mcp add --transport http swaggerbot https://swaggerbot.dev/mcp
# with an API key, for Discovery and fresh:
claude mcp add --transport http swaggerbot https://swaggerbot.dev/mcp --header "Authorization: Bearer <secret>"
```

Five tools, each a thin adapter over the HTTP API's code. Each returns `structuredContent` (the JSON) and a text that begins with a sentence for the agent and the next call to make; an error is `isError` with what went wrong and the call that fixes it.

| Tool | Gives | Over |
|---|---|---|
| `lookup_api({ name, apiVersion?, allowCommunity?, fresh? })` | The Outcome, with the Spec's download URLs (the Spec itself is never returned inline). | `POST /api/lookup` |
| `list_vendor_apis({ vendor })` | A Vendor's APIs in the Index, each with its Current Spec. | `GET /api/vendors/{vendor}/apis` |
| `get_spec_outline({ apiId, specId?, tag?, query?, cursor? })` | One page (at most 100) of the Spec Outline's operations, filtered by tag or by a word of the path, `operationId` or summary, with the tag list; `nextCursor` for the next page. | `GET /api/apis/{apiId}/outline` |
| `get_operation({ apiId, method, path, specId? })` | One operation with the references it reaches inlined; a path that isn't in the Spec gets the nearest ones. | `GET /api/apis/{apiId}/operation` |
| `get_schema({ apiId, name, specId? })` | One component schema, to follow a reference `get_operation` or `get_schema` left. | `GET /api/apis/{apiId}/schema` |

**Keys:** the same rules as the HTTP API ([Access](#access)). The key is optional: Index answers, the outline, operations, schemas and Vendor lists are open under the per-IP limit; Discovery and `fresh` need a key and use its quota. A key that is sent but isn't live is HTTP 401 (`WWW-Authenticate: Bearer`) before any tool runs. Every request to `/mcp` counts against the per-IP rate limit shared with `/api/`.

**Result sizes:** every result stays under 30 kB (its `structuredContent` as JSON plus its text), below Claude Code's 10,000-token warning. `get_spec_outline` holds a page to that and, on a Spec over 100 operations without a filter, gives the tag list and the first page and says to filter. `get_operation` and `get_schema` inline breadth-first to 24 kB; past that a reference is `{ "$ref", "x-truncated": true }`, which `get_schema` follows. A schema that recurs within itself is `{ "$ref", "x-circular": true }`.

To check the MCP server on a deployment, run `pnpm tsx scripts/mcpcheck.ts https://swaggerbot.dev` (`--names "Stripe,GitHub REST API,Cloudflare"` by default, `--json` for the whole report, `--help` for the rest; set `LOADCHECK_KEY` to send it as the bearer). It connects with the MCP SDK's HTTP client, lists the tools (all five must be there) and, for each name, calls `lookup_api` (which must be Resolved), `get_spec_outline` without a filter and then with a `query` taken from its first page, `get_operation` on 3 operations of that filtered page and `get_schema` on one schema reference they left. Calls are paced under the default 60/min per-IP limit. It prints each call's time and result size and exits 0 when no call failed, every result is under 30 kB and every call, the Lookups from the Index included, took at most 2 s; otherwise it exits 1, naming what failed.

## Crawling etiquette

The fetcher (`src/fetch/fetcher.ts`) sends an honest User-Agent, spaces requests per host and respects `robots.txt`. The one exception is [ADR 0003](docs/adr/0003-robots-txt-exception-for-vendor-linked-specs.md): a single Spec document linked from an allowed Vendor page is fetched once even when its own host's `robots.txt` disallows it (`fetchUrl(url, { ignoreRobots: true })`), and never crawled on from; the result's `robotsDisallowed` records that it happened. The same holds for a Spec at a known path on the Vendor's own API host when that host's `robots.txt` disallows its whole site (`Disallow: /`, as an app host like `api.val.town` does): the known-path probe retries that one path once with `ignoreRobots`, but only for the Vendor's own domain and never when `robots.txt` merely lists disallowed paths (Codeberg's `/swagger.*.json`) or could not be fetched. Either way the Lookup adds a diagnostic naming the URL.

It also caps a fetched body at 64 MB, counted as it streams in (after decompression) and aborted the moment it passes the cap, so an enormous response is never buffered whole. Set `MAX_SPEC_BYTES` (in bytes) to change the cap; a value that is not a positive integer is ignored with a warning.

## Check

```sh
pnpm check   # Biome lint, tsc --noEmit, vitest run; stops at the first failure
```

The same `pnpm check` and `pnpm build` run in CI (`.github/workflows/ci.yml`) on every PR and push to `main`.
