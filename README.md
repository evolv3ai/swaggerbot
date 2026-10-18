<img src="swaggerbot-logo-bw.svg" alt="swagger.bot logo" width="96" height="96">

# swagger.bot

swagger.bot turns the name of an API into a verified OpenAPI/Swagger Spec with its Provenance, or says honestly why it can't. It is a single TanStack Start app (HTTP API, MCP endpoint and web UI) with the Index in SQLite. See [`docs/PRD.md`](docs/PRD.md) for what it does and why, [`CONTEXT.md`](CONTEXT.md) for the glossary and [`docs/adr/`](docs/adr/) for the decisions behind it. To use it rather than run it, read the docs at [swaggerbot.dev/docs](https://swaggerbot.dev/docs): the HTTP API with a `curl` and its answer for each route, the MCP server, the `swaggerbot` CLI, the key rules and how to get a key. The CLI is summed up under [CLI](#cli) below and documented in full in [`cli/README.md`](cli/README.md).

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
pnpm build   # production build into .output/, plus the public CLI bundle (cli/dist/)
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

The same rules, with a worked example of each route, are on the site at [`/docs`](https://swaggerbot.dev/docs).

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

The routes, all but `GET /api/health` under the per-IP limit:

| Route | Gives | Key |
|---|---|---|
| `POST /api/lookup` | The Outcome. | For Discovery and `fresh` |
| `GET /api/specs/{specId}/published`, `…/normalized` | The Spec's Published Form or Normalized Form. | No |
| `GET /api/apis/{apiId}/outline`, `…/operation`, `…/schema` | The Spec Outline (paged with `tag`, `query`, `cursor`, `limit`), one operation, one component schema. | No |
| `GET /api/vendors[?query=&cursor=&limit=]` | The Vendors with at least one API in the Index, by name, each with its `id`, `name` and `apiCount`: 50 a page by default (`limit` at most 200), `query` a substring of the id or name ignoring case, with `total` and `nextCursor` (null on the last page). 400 for a bad `limit` or `cursor`. | No |
| `GET /api/vendors/{vendor}/apis` | A Vendor's APIs in the Index, each with its Current Spec. | No |
| `GET /api/key` | The key the bearer names: `{ id, remaining?, limit?, resetsAt? }`, today's credits as far as the key store knows them, verified without spending one (the CLI's `login` and `key`). 400 without a bearer, 401 for a key that isn't live, 503 with `Retry-After` when the key store can't say. Never cached. | Yes (costs nothing) |
| `GET /api/health` | `{"ok":true}`. | No |

Every API route answers a method it doesn't take with 405 and an `Allow` header, and a path under `/api/` that no route serves with a JSON 404, never the web page.

## API keys

Discovery and `fresh` Lookups need an API key, each with a daily quota of credits, refilled at midnight UTC. Anyone gets one at [swaggerbot.dev/keys](https://swaggerbot.dev/keys) ([ADR 0006](docs/adr/0006-keys-in-unkey-accounts-in-workos.md)): they sign in with GitHub or by email (WorkOS AuthKit) and create a key, with no one approving it. The secret is shown once, when it is made. One key per person: a second can't be created while the first is live. The page shows the key's start, when it was made, today's credits left and when they reset, and has **Roll** (a new secret, today's credits kept) and **Revoke** (after which the person may create a new one). A new key's quota is `DAILY_QUOTA` (default 100); a larger one is asked for at hello@evolv3.ai.

Keys live in [Unkey](https://unkey.com) and accounts in [WorkOS](https://workos.com); swagger.bot stores no users. A key's owner is its Unkey identity, whose `externalId` is the WorkOS user id. These env vars (in `.env.example`) turn it on:

| Variable | Meaning |
|---|---|
| `UNKEY_ROOT_KEY` | A root key scoped to the swagger.bot API alone (`create_key`, `verify_key`, `read_key`, `update_key`, `delete_key` on it). |
| `UNKEY_API_ID` | The API (`api_…`) keys are created in. |
| `UNKEY_KEYSPACE_ID` | The API's keyspace (`ks_…`): verification accepts only its keys. |
| `UNKEY_MIGRATION_ID` | Only for `keys.ts migrate`, from Unkey support. |
| `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` | The WorkOS environment, with GitHub and Magic Auth on. |
| `WORKOS_COOKIE_PASSWORD` | Seals the session cookie; at least 32 characters. |
| `WORKOS_REDIRECT_URI` | `https://<host>/auth/callback`. |

With `UNKEY_ROOT_KEY` and `UNKEY_API_ID` set, keys are verified in Unkey (the start log says `keys: unkey`): an Index answer costs nothing, a Discovery or `fresh` Lookup one credit, and when Unkey doesn't answer within 2 s a keyed request gets a 503 with `Retry-After: 30` (keyless Index answers are unaffected). Without them, keys stay in the Index's SQLite table as before (`keys: local`), which is what tests and local development use. `/keys` needs both Unkey and WorkOS; without them it says keys are issued by hand and links the email. Without the WorkOS env, the top bar shows no "Sign in" and `/auth/*` is a 404.

The operator can still issue keys by hand, on whichever store is configured (in Unkey, `create` makes the owner `operator.<owner>`):

```sh
pnpm tsx scripts/keys.ts create "<owner>" [--quota N]   # prints the key's id and secret
pnpm tsx scripts/keys.ts list                            # id, owner, quota, created, revoked, today's usage
pnpm tsx scripts/keys.ts revoke <id>
pnpm tsx scripts/keys.ts migrate                         # move the Index's live keys into Unkey
```

`migrate` moves every live key in the Index at `DATABASE_PATH` into Unkey with its secret unchanged (the stored sha256 is re-encoded as Unkey expects), its owner as `operator.<owner>` and its quota as daily credits. It needs `UNKEY_ROOT_KEY`, `UNKEY_API_ID` and `UNKEY_MIGRATION_ID`, and prints how many keys moved and any it couldn't. Run it before the first deploy with Unkey, so no hand-issued key stops working.

In production the image has no `scripts/` or `tsx`. `pnpm build` bundles the same CLI into `.output/cli/keys.mjs`, which the image carries, so run it in the container, against the Index on its volume:

```sh
docker exec <container> node .output/cli/keys.mjs create "<owner>" [--quota N]
docker exec <container> node .output/cli/keys.mjs list
docker exec <container> node .output/cli/keys.mjs revoke <id>
docker exec <container> node .output/cli/keys.mjs migrate
```

A secret is shown only when it is made: neither store keeps it (the Index keeps its sha256). The id (`key_…`) is safe to show and is what `list` and `revoke` use. A key without `--quota` gets the default, 100 a day, or `DAILY_QUOTA` when that is set.

To check keys on a deployment, run `KEYCHECK_KEY=<secret> pnpm tsx scripts/keycheck.ts https://swaggerbot.dev` (`--name "Val Town"` by default, a name already in the Index; `--json` for the whole report, `--help` for the rest). It checks that a keyless Index Lookup is 200; that the same with the key is 200 and doesn't change the key's credits; that a Discovery (`fresh: true`) with the key is 200 and spends one credit; and that a made-up `sb_` key is 401. With `UNKEY_ROOT_KEY` set it reads the key's credits before and after through Unkey's admin API (`keys.whoami`); without it the credit checks are skipped. It uses one of the key's credits, prints each Lookup with PASS/FAIL and exits 1 when a check fails.

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

## CLI

`swaggerbot` is the command-line client, for people at a terminal: a client of the HTTP API only (`src/cli/`, packaged in `cli/`). It needs Node 20 or later.

```sh
npx swaggerbot lookup "Val Town"   # run it without installing
npm install -g swaggerbot          # or keep it
```

A name the Index answers needs no key. For Discovery and `--fresh`, get a key at [swaggerbot.dev/keys](https://swaggerbot.dev/keys) and store it with `swaggerbot login`: it asks for the key, hidden (or reads it from a pipe, or `--key`), checks it with `GET /api/key` at no cost to its credits and stores it only when it is live. `swaggerbot key` shows the key in use and its credits; `swaggerbot logout` forgets it. A command sends `--key`, else `SWAGGERBOT_API_KEY`, else the stored key.

The stored keys live in a config file readable only by you (`0600`): `$XDG_CONFIG_HOME/swaggerbot/config.json` (`~/.config/swaggerbot/config.json`), `%APPDATA%\swaggerbot\config.json` on Windows, or wherever `SWAGGERBOT_CONFIG` points. Each key is kept under the origin it was checked with and sent to that origin only.

| Command | Gives | Example |
|---|---|---|
| `lookup <name> [--api-version V] [--community] [--fresh]` | The Outcome in one line: the API, its Spec's URL and Provenance, or why there is none. | `swaggerbot lookup "Val Town"` |
| `login [--key K]` | Checks a key and stores it for this swagger.bot. | `swaggerbot login` |
| `logout` | Forgets the stored key. | `swaggerbot logout` |
| `key` | The key in use: its id, credits left today, when they reset. | `swaggerbot key` |
| `spec <name \| apiId \| specId> [--form published\|normalized] [--api-version V] [-o FILE] [--force] [--no-wait]` | Downloads the Spec and checks its sha256 is its Spec id. | `swaggerbot spec "Val Town" -o openapi.json` |
| `outline <name \| apiId> [--tag T] [--query Q] [--spec-id S] [--limit N] [--all]` | The Spec Outline: title, servers, security schemes, tags, then the operations. | `swaggerbot outline val.town/api --tag me` |
| `operation <name \| apiId> <method> <path> [--spec-id S]` | One operation, every reference inlined, as JSON. | `swaggerbot operation val.town/api delete /v1/blob/{key}` |
| `schema <name \| apiId> <schemaName> [--spec-id S]` | One component schema, as JSON. | `swaggerbot schema val.town/api PaginationLinks` |
| `vendors [<query>] [--all]` | The Vendors in the Index, 50 a page. | `swaggerbot vendors val` |
| `vendor <vendor>` | A Vendor's APIs in the Index, each with its Current Spec. | `swaggerbot vendor val.town` |

`--json` prints the same JSON as the HTTP API (on a failed request, its error body too), so the [routes](#access) and the examples on [`/docs`](https://swaggerbot.dev/docs) describe it. `--url <origin>` (or `SWAGGERBOT_URL`) points the CLI at a self-hosted swagger.bot; `--no-color` (or `NO_COLOR`) turns colour off.

Exit codes, the same with `--json`: `0` Resolved, or the command did what it was asked; `3` Ambiguous; `4` Unconfirmed; `5` No Spec; `6` Unknown; `1` refused or failed (no key, quota used, the service unreachable, a download that isn't its Spec); `2` usage error.

`pnpm build` bundles it into `cli/dist/swaggerbot.mjs` (`pnpm build:cli` alone); `node cli/dist/swaggerbot.mjs --url http://localhost:3000 lookup stripe` runs it against `pnpm dev`.

## Ask this Spec

On a Spec's page (`/specs/{specId}#ask`), a signed-in person can ask questions about that one Spec and get answers in plain text, each statement citing the operation, schema or fact of the Spec it comes from; when the Spec doesn't say, the answer says so ([ADR 0007](docs/adr/0007-ask-this-spec-answers-from-the-normalized-form.md)). Code picks the parts of the Normalized Form a question is about and a Claude model answers from them in one call; the model is never in the Lookup, Discovery or Verification path and writes nothing into the Index. Asking needs sign-in and is counted per person, `CHAT_DAILY_TURNS` questions a UTC day (default 30, reset at 00:00 UTC, shown on `/keys`); it spends no API key credits. It is not part of the HTTP API or MCP: `POST /specs/{specId}/ask` serves the Spec page's panel only, and an agent reads the same Spec with `get_spec_outline`, `get_operation` and `get_schema`.

| Variable | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Turns the feature on (with WorkOS sign-in). Without it the Spec page has no Ask this Spec section and the route answers 404. |
| `CHAT_MODEL` | The model that answers (default `claude-opus-5-5`). |
| `CHAT_EFFORT` | Its effort: `low` (the default), `medium`, `high`, `xhigh` or `max`. |
| `CHAT_DAILY_TURNS` | Questions a signed-in person may ask a UTC day (default 30). |
| `CHAT_LOG_TEXT` | `1` keeps each turn's question and answer, for a tuning period; unset, only its figures are kept. |
| `CHAT_FAKE` | `1`, for local checks only: with no `ANTHROPIC_API_KEY` and no WorkOS sign-in, turns are answered by a model scripted from the chat Benchmark and asked as one stand-in person, so `chatcheck` can run against a built server without a real model. With sign-in and no key, development only (refused under `NODE_ENV=production`): turns are answered by a scripted model, so the panel can be tried without a key. |

Each turn is logged in `chat_turns` with its model, tokens, latency, what was sent and how it ended, never the question or the answer unless `CHAT_LOG_TEXT=1`. The Verification worker deletes turns older than 90 days once a day. To see them:

```sh
pnpm tsx scripts/chatstats.ts [--since YYYY-MM-DD] [--json]   # turns, people, tokens, refusals, errors, estimated cost
docker exec <container> node .output/cli/chatstats.mjs [--since YYYY-MM-DD] [--json]
```

The cost is estimated from a price table in `src/index-store/chatstats-cli.ts` (per model, per million tokens, with the day the prices were read); a model missing from it is listed as unpriced.

The chat Benchmark, `benchmark/chat.json`, holds 30 labelled questions about Val Town, Stripe and the GitHub REST API: `answerable` ones with the operations or schemas an answer must cite, `not-in-spec` ones the Spec can't answer, and `off-topic` and `action` ones it must decline. To check Ask this Spec against it, sign in to the deployment in a browser, copy the request's `Cookie` header, and run `CHATCHECK_COOKIE='<cookie>' pnpm tsx scripts/chatcheck.ts https://swaggerbot.dev` (`--names "Val Town,Stripe"` for some of them, `--json` for the whole report, `--help` for the rest). It looks each name up from the Index, asks each question on its Current Spec and reads the answer's stream; an `answerable` answer must cite every expected operation and schema, an `off-topic` one must decline (no citation, and the decline phrasing), an `action` one must decline (the decline phrasing; it may cite the Spec explaining how the call works), and a `not-in-spec` one is reported if it says the Spec doesn't say. It prints each answer, the time to first byte and to done, and the tokens, and exits 0 when expected citations are present for at least 90% of the answerable questions, nothing was answered that should have been declined, no turn failed and the p90 to done is under 15 s; otherwise 1. Every question spends one of that person's questions for the day, and with a real model it costs money; the run stops at the first 429 and says how many questions ran. Against a local build: `CHAT_FAKE=1 TYPESAFE_API_KEY=unused pnpm start` with an Index that holds the three Specs, then `CHATCHECK_COOKIE=unused pnpm tsx scripts/chatcheck.ts http://localhost:3000`.

## Crawling etiquette

The fetcher (`src/fetch/fetcher.ts`) sends an honest User-Agent, spaces requests per host and respects `robots.txt`. The one exception is [ADR 0003](docs/adr/0003-robots-txt-exception-for-vendor-linked-specs.md): a single Spec document linked from an allowed Vendor page is fetched once even when its own host's `robots.txt` disallows it (`fetchUrl(url, { ignoreRobots: true })`), and never crawled on from; the result's `robotsDisallowed` records that it happened. The same holds for a Spec at a known path on the Vendor's own API host when that host's `robots.txt` disallows its whole site (`Disallow: /`, as an app host like `api.val.town` does): the known-path probe retries that one path once with `ignoreRobots`, but only for the Vendor's own domain and never when `robots.txt` merely lists disallowed paths (Codeberg's `/swagger.*.json`) or could not be fetched. Either way the Lookup adds a diagnostic naming the URL.

It also caps a fetched body at 64 MB, counted as it streams in (after decompression) and aborted the moment it passes the cap, so an enormous response is never buffered whole. Set `MAX_SPEC_BYTES` (in bytes) to change the cap; a value that is not a positive integer is ignored with a warning.

## Check

```sh
pnpm check   # Biome lint, tsc --noEmit, vitest run; stops at the first failure
```

To work on the code, read [`docs/development.md`](docs/development.md): the source layout, the test rules and the environment variables.

`uicheck`'s tests drive a headless Chromium: install it once with `pnpm exec playwright install chromium`.

The same `pnpm check` and `pnpm build` run in CI (`.github/workflows/ci.yml`) on every PR and push to `main`.

## Web UI

The pages are server-rendered TanStack Start routes. Their styles are Tailwind 4 with [shadcn](https://ui.shadcn.com) (`components.json`; components go in `src/components/ui/`, the `cn` helper is `src/lib/utils.ts`), and the theme tokens are CSS variables in `src/styles/app.css`, light and dark by `prefers-color-scheme`. A route loads `app.css` itself (`import appCss from "~/styles/app.css?url"` in its `head` links), so Tailwind's preflight reaches only the pages that use it. Inter and JetBrains Mono are self-hosted under `public/fonts/` (`src/styles/fonts.css`).

Every HTML page is served with a Content Security Policy that allows only this origin, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` (`src/server/security-headers.ts`, a request middleware listed in `src/start.ts`). The inline scripts TanStack Start writes for hydration carry a per-request nonce. `/api/…` and `/mcp` keep their own headers.

To check pages for WCAG AA and keyboard use, run `pnpm tsx scripts/uicheck.ts http://localhost:3000 --routes /,/docs` (`/` by default, `--json` for the whole report, `--out` for the screenshots, `uicheck-out/` by default; `--help` for the rest). For each route, at 390 and 1280 wide and in light and dark, it runs axe-core with the tags `wcag2a wcag2aa wcag21aa wcag22aa`, tabs through the page until focus comes back to the start (every interactive element must be reached, none may trap focus, and each needs a visible focus indicator), watches the console for Content Security Policy violations and saves a screenshot. It exits 0 when every run passed; otherwise 1, naming what failed.
