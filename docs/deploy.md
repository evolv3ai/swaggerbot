# Deploying swagger.bot

The operator runbook for the live service ([Slice 3](slices/slice-3-backlog.md), ADR 0002). swagger.bot runs as one container on Coolify. The Index is a SQLite file on a local Docker volume, replicated continuously to Backblaze B2 by Litestream. This page records what exists and how it was made, so a restore or a rebuild can follow it. Secrets never go in this file: it names where they live.

## What exists

| Thing | Where |
|---|---|
| Coolify | `https://coolify.8gnc.com` (v4.3.23), on the Contabo server `cbo-01-217-110` (`217.216.90.110`, SSH alias `cbo-01-217-110`, user `admin` with sudo) |
| CLI access | `coolify --context 8gnc …`. The API token is `claude-swaggerbot` (abilities read, write, deploy), stored only in `~/.config/coolify/config.json` on WOPR3's WSL. Revoke it in Coolify under Keys & Tokens. |
| Project | `swaggerbot` (`sk3lxvcsepxflz8srxm1vzm6`), environment `production` |
| Application | `swaggerbot` (`z1hr4xe7sa8ni5s5zbryey6y`), public repo `evolv3ai/swaggerbot`, branch `main`, Dockerfile build pack, port 3000, memory limit 2 GB, domain `https://swaggerbot.dev`. **Coolify's health check is off**: Coolify probes with curl or wget inside the container, and the image has neither. The image's own `HEALTHCHECK` (node `fetch` of `/api/health`) is what Docker reports. |
| Volume | `z1hr4xe7sa8ni5s5zbryey6y-swaggerbot-data` mounted at `/app/data` (a local named volume; SQLite must not sit on a network filesystem) |
| Backup | B2 bucket `swaggerbot-litestream` (private, account endpoint `s3.us-east-005.backblazeb2.com`). A lifecycle rule deletes hidden file versions after 1 day, so Litestream's own retention decides what is kept. Replica path `swaggerbot`. |
| B2 key | application key `swaggerbot-litestream`, restricted to that bucket (listBuckets, listFiles, readFiles, writeFiles, deleteFiles). Its secret exists only in Coolify's env vars. |
| DNS | `swaggerbot.dev` is registered at Namecheap, with nameservers moved to Cloudflare (`ashley`/`kyle.ns.cloudflare.com`) and proxied. Cloudflare's SSL mode must be **Full or Full (strict)**: Flexible would loop against Traefik's HTTPS redirect. |

**Environment variables set in Coolify** (values in Coolify only): `LITESTREAM_BUCKET`, `LITESTREAM_PATH`, `LITESTREAM_ENDPOINT` (the full `https://` URL), `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`, `TYPESAFE_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `GITHUB_SEARCH_TOKEN` and `CLIENT_IP_HEADER=cf-connecting-ip` (the proxy is Cloudflare; read once WTR-92 lands). `PUBLIC_BASE_URL=https://swaggerbot.dev` was added 2026-09-23 (Slice 4 O2), before WTR-106 deploys, so the Outcome's download URLs are absolute. The app keys were copied from the repo's local `.env` and `.env.local`. `DATABASE_PATH` comes from the Dockerfile (`/app/data/swaggerbot.db`). Coolify keeps a preview copy of each variable; preview deployments are off.

## Steps

- [x] **O1. B2 bucket and key** (2026-09-23). `b2 bucket create --default-server-side-encryption SSE-B2 --lifecycle-rule '{"daysFromHidingToDeleting":1,…}' swaggerbot-litestream allPrivate`, then `b2 key create --bucket swaggerbot-litestream swaggerbot-litestream listBuckets,listFiles,readFiles,writeFiles,deleteFiles`. The key went straight into Coolify without being printed.
- [x] **O2. Coolify app** (2026-09-23): project, app, volume and env vars as above, through the Coolify API. It is **not deployed**: there is no Dockerfile until WTR-89 merges.
- [x] **O3. DNS** (Wes, 2026-09-23). The domain is on Cloudflare, proxied to the origin `217.216.90.110`, where Coolify's Traefik takes 80/443 (ufw allows both). There's no tunnel.
- [x] **O4. First deploy** (2026-09-23, `f832ba6`). Deploy with `POST /api/v1/deploy?uuid=z1hr4xe7sa8ni5s5zbryey6y`; the GET form is gone. The first attempt was rolled back by Coolify's curl-based health check (see Application above). Once that was off, `https://swaggerbot.dev/api/health` answered 200, Docker reports the container healthy, `.ltx` files appear under `b2://swaggerbot-litestream/swaggerbot/`, and a live Lookup of Stripe resolved (7.5 s Discovery; 0.44 s from the Index, end to end through Cloudflare).
  - **Before the image was merged**, it was built on the server from the PR branch and a restore was tried against real B2 under a throwaway path `verify-49`. A row written in one container came back in a fresh container on an empty volume. The path was deleted afterwards. That is a smoke test, not O5.
  - **The gate is live** since the redeploy with WTR-92 (`324bef9`, 2026-09-23). An Index answer is open to anyone (Stripe, 0.43 s through Cloudflare). Discovery and `fresh` without a key get 401 `Discovery needs an API key.`. The Index survived the redeploy on its volume.
  - **Load-check key** `key_qyg4vkdz` (owner `loadcheck (operator)`, 200 a day). Its secret is `LOADCHECK_KEY` in the repo's gitignored `.env.local` on WOPR3. It was checked live: 200, `x-quota-remaining: 199`.
  - **Issuing keys.** `key_qyg4vkdz` was inserted by hand (`sb_` + 32 random bytes in base64url, its sha256 hex written into `api_keys` with the container's own `better-sqlite3`), because the image then had no way to run `scripts/keys.ts`. Since WTR-98 the image carries the CLI, bundled by `pnpm build`: `docker exec <container> node .output/cli/keys.mjs create "<owner>" [--quota N]`, `… list`, `… revoke <id>`. It opens `DATABASE_PATH` (`/app/data/swaggerbot.db`), so it works on the live Index. The container's name comes from `docker ps` on the server (`--filter name=z1hr4xe7sa8ni5s5zbryey6y`). Checked live after the WTR-98 redeploy (2026-09-23): `list` shows the hand-made `key_qyg4vkdz` with its use counted, so the formats match.
- [x] **O5. Restore rehearsal** (2026-09-23, against the production replica, image `782dc6f`). Done on the server, without touching the live container or its volume:
  1. The Litestream settings went into a root-only env file, written by Coolify's tinker and shredded afterwards.
  2. `docker run --rm --env-file … -v o5-restored:/app/data --entrypoint sh <image> -c "litestream restore -config /app/docker/litestream.yml -o /app/data/swaggerbot.db /app/data/swaggerbot.db"`: **3 s**.
  3. Row counts in every table (vendors, apis, specs, sources, api_names, api_keys, api_key_usage, verifications) and the latest `last_verified_at` were **identical** to the live database, read with a read-only `better-sqlite3` in the live container.
  4. The app booted from the restored volume **with replication off** (no `LITESTREAM_*`; a second replicator on the same replica path would corrupt it), on a loopback port. A Lookup of Stripe gave **the same answer as production**: API, Current Spec id and `verifiedAt`.
  5. Everything was removed afterwards: containers, the volume and the env files.

  **To restore for real:** stop the app in Coolify, then either delete the volume's `swaggerbot.db*` (the entrypoint restores when the database is missing and a replica exists), or restore into a new volume as in step 2 and mount it at `/app/data`. Then start the app, which replicates again.
  **Gotcha:** the app needs its API keys (`TYPESAFE_API_KEY` and the rest) even to serve Index answers, because `createApp` builds the Judge. Since WTR-119 it is built at start-up. Booted without them, the server logs "The background Verification and forms workers didn't start", `/api/health` still answers, and every Lookup returns 500.
- [x] **O6. Load check** (2026-09-23, image `b7c880b`): `set -a; . ./.env.local; set +a; pnpm tsx scripts/loadcheck.ts https://swaggerbot.dev --json` (the key comes from `LOADCHECK_KEY`). **Index p90 80 ms; Discovery p90 14.2 s, and 12.3 s on a second run.** Both pass. Details are in [`slices/slice-3-result.md`](slices/slice-3-result.md). A full run uses one quota unit per Benchmark entry (40).

## Slice 4: Spec forms in production

The deploys of 2026-09-23:
- **`22aed14`** (wave 2 + WTR-107/116/117) at 15:36 CDT, deployment `lrcy75ypyd84ft2sqm1aqq98`.
- **`30d7ebf`** (WTR-106, wave 4, WTR-111, WTR-119) at 18:47, deployment `bvdnafz14ryqve337pzadg28`. The Coolify build took 49 s.

`PUBLIC_BASE_URL` is confirmed live: an Index answer's `downloads` are `https://swaggerbot.dev/api/specs/<id>/published|normalized`.

**Workers start at boot (WTR-119).** Before it, the app, and with it the forms and Verification workers, was built on the first valid Lookup or download. `/api/health` doesn't count. After the `22aed14` deploy, nothing ran for 2 h 20 min: 0 of 27 Specs had a `spec_forms` row, and Litestream saw no write. One open `GET /api/specs/<id>/published` at 17:55 started it. Checked on the `30d7ebf` image in a throwaway container on the server, with no port published: a copy of the Index (taken with `better-sqlite3`'s `.backup()` inside the live container, so the WAL is included) with one `spec_forms` row deleted was rebuilt about 2 s after start-up, with no request. To check a deploy by hand: `docker logs <container>` must not show "workers didn't start".

**O1, the backfill** (image `22aed14`, 17:55–18:45 CDT, sampled every ~20 s):
- **27/27 ready, 0 failed, every one on its first attempt.** 26 Specs took 0.0–6.9 s each: Cloudflare 26.0 MB in 6.9 s, Stripe 6.4 MB in 5.7 s, Infisical 13.5 MB in 5.2 s, GitHub 13.0 MB in 2.7 s.
- **DigitalOcean took 2,938 s (49 min)**, fetching its 2,976 `$ref`d files inside the 75 min budget. Nothing else was built while it ran: the worker builds one Spec at a time, and the other 20 Specs finished in the minute after it.
- **Memory:** the container peaked at **514 MiB** sampled (of 2 GiB), right after DigitalOcean finished, as the queued large Specs started. It was 466–470 MiB in the first minutes, after the six Specs built before DigitalOcean, and dropped to 165–190 MiB from 18:00 while DigitalOcean was fetching. The idle baseline before the backfill was 52 MiB.
- **Index latency during the backfill** (`scripts/loadcheck.ts https://swaggerbot.dev --only index`, 17:57, while DigitalOcean was fetching): **p50 63 ms, p90 80 ms, max 207 ms, 0 errors, PASS (< 200 ms).** The 21 skipped 401s are Benchmark names the Index doesn't hold, by design. This run didn't overlap a CPU-heavy build (those take seconds), so it bounds the cost of reference fetching, not of parsing.
- **Findings:** DigitalOcean's Normalized Form has 697 findings. It writes every operation as a `$ref`, which `bundle` leaves as `{ "$ref": "#/x-ext/…" }` stubs, so its Outline and `get_operation` show stubs. Fixed by WTR-120 (Slice 4 #13), deployed as `d725125` at 18:54. DigitalOcean's `spec_forms` row was then deleted by hand (18:54:41). The worker picked it up 6 s later with no request, and it was **ready at 19:44 (2,997 s) with 2 normalized findings, down from 697**. Checked live by `?specId=e3cd049d…`: the Outline has 695 operations, all with an `operationId`, and `get_operation` for `GET /v2/1-clicks` returns the whole operation (5 responses, 12.9 kB, 0.29 s). The peak sampled while it ran was 493 MiB.
- **A DigitalOcean build holds up every other Spec for ~50 min.** The Discovery `loadcheck` at 19:03 (`fresh` Lookups) stored new Current Specs for eight APIs, because their vendors' files had changed upstream: DigitalOcean, Stripe, Cloudflare, Asana, PagerDuty, OpenAI, Infisical and Fly.io. The new DigitalOcean Spec (`9601e8c3`) started its own ~50 min build at 19:44, and **Cloudflare's and five other new Current Specs answer 409 until it finishes** (~20:35). The worker builds one Spec at a time, and WTR-117 only orders retries. So whenever DigitalOcean changes upstream and a Lookup refreshes it, the forms of every Spec found after it are delayed about 50 minutes. That's a design decision for Wes (options in [`slices/slice-4-result.md`](slices/slice-4-result.md)). Supabase has 15 Validity Issues as published. Box (2 Specs) and Replicate have 1 normalized finding each.

**O4, part 1: `formscheck`** (18:48, `30d7ebf`, `LOADCHECK_KEY` set): **PASS.**
- Outline p90 150 ms (target < 500 ms), operation p90 347 ms (target < 2 s).
- Downloads: Cloudflare 26.0 MB published in 487 ms, 12.9 MB normalized in 309 ms.
- The outlines have 1,221 operations (GitHub), 594 (Stripe) and 3,576 (Cloudflare).
- Every sampled Stripe operation comes back `truncated` at about 1 MB.
- `GitHub` isn't a name the Index remembers, so the Lookup ran Discovery (9.1 s) and found a new GitHub Spec. The worker built it in about 5.6 s while formscheck waited on a 409.


### The follow-ups: `d74a3c9` (2026-09-24)

**Deployed at 00:24 CDT** (deployment `jjiwxlosk4tlaw0l8xzsadmt`; healthy at 00:25). It carries WTR-121 (two forms lanes), WTR-122 (`builder_version`), WTR-123 (Vendor names), WTR-124 (map `$ref`s), WTR-125 (Dropbox redirect) and WTR-101 (add-on guard). Migrations 0008 and 0009 add `spec_forms.external_refs` and `builder_version`. 0009 also resets `attempts` on `ready` rows; none of the 37 had any.

**The rebuild after the bump** (every row started stale, `builder_version` null; sampled every ~20 s):
- 35 of 37 Specs reached version 1 within 90 s of start-up (00:25:25 → 00:26:47), all in the local lane.
- `GET /api/apis/stripe.com/stripe-api/outline` answered **200 in every sample** throughout. A rebuild keeps the stored forms.
- Memory peaked at 540 MiB sampled, then settled to ~260 MiB.
- The other 2 are DigitalOcean's Specs, handed to the external lane. **It took the superseded `e3cd049d` first** (oldest `built_at`), so the Current `9601e8c3` waits ~50 min behind it. Filed as WTR-126: Current Specs rebuild first.
- **`formscheck` PASS at 00:28 while DigitalOcean was building** (outline p90 182 ms, operation p90 380 ms, 0 non-2xx). This is WTR-121's live check: one DigitalOcean build no longer holds up the others.

**Live checks** (00:26–00:28):
- **WTR-123:** `/api/vendors/{Stripe,Slack,PagerDuty,GitHub}/apis` are 200, each listing its API. `nosuch` is 404. `Jira` is also 404: its Vendor is `atlassian.com`, and the remembered name is "jira cloud platform rest".
- **WTR-125 and WTR-101** (`fresh` Lookups through Cloudflare, with the load-check key):

  | Name | Outcome | Time | Before |
  |---|---|---|---|
  | Dropbox API | **NoSpec**, `dropbox.com/api` | 21.3 s | Unknown |
  | DigitalOcean API | Resolved | 2.2 s | ~10 s |
  | Jira Cloud platform REST API | Resolved | 3.6 s | ~10 s |
  | Plaid API | Resolved | 3.8 s | 15–17 s |
  | Twilio Verify API | Resolved | 12.4 s | ~10 s |

  Twilio Verify is still slow: its Spec has 33 paths, under `ADD_ON_MAX_PATHS` (40), and Box's add-on has 24. The issue assumed "hundreds".

**`2cc7d32` (WTR-126) deployed at 00:30** (deployment `yq7nhwrwwozkdegfxtiqsebs`; healthy at 00:30:55). The restart abandoned the superseded DigitalOcean rebuild, which stays `ready` on its old forms. After start-up, the external lane took the **Current** Spec `9601e8c3` first (started 00:30:40), which is WTR-126's live check. It was **ready at 01:20:31 with `builder_version` 1 and 2 normalized findings, down from 62** (the 2 tag descriptions; WTR-124's map inlining), after 2,990 s. It has 718 Validity Issues. `get_operation` for `GET /v2/1-clicks` answered 200 in 0.30 s. The monitor (every ~20 s, 00:25–01:40) saw 188 of 189 Stripe `/outline` samples answer 200. The one 502 was at 00:31:29, about 30 s after the `2cc7d32` container reported healthy, during Coolify's container switch-over, so a deploy blips for well under a minute. Peak memory sampled: 540 MiB.

### `d0175c1` (2026-09-24): API fallbacks, WTR-128 and the landing page

**Deployed at 10:40 CDT** (deployment `irs4eyrms5dnpubkbo3awjsp`). It carries:
- #80: every API route answers a method it doesn't take with 405 JSON and `Allow`, and an unknown `/api/…` path with a JSON 404. Before, TanStack Start rendered the app for both: `GET /api/lookup` was a blank 200 HTML page.
- #79 (WTR-128, backlog #20): a Vendor is found by the first word of a remembered API name.
- #81: the landing page that replaces "coming soon" (ahead of Slice 6), with a description, OG tags, `/og.png` and `/favicon.svg`.
- `0b8a105`: `pnpm bench` loads `.env` and `.env.local`.

**Live checks through Cloudflare** (10:41):
- `/` 200, with the new title, description and `og:image`. It hydrates, the health line reads "The service is up", and there are no console errors. `/og.png` and `/favicon.svg` are 200.
- `GET /api/lookup` 405 (`Allow: POST`); `POST /api/health` 405 (`Allow: GET, HEAD`); `GET /api/nope` JSON 404.
- `/api/vendors/Jira/apis` **200**, Vendor `atlassian.com` with `atlassian.com/jira`; `Jir` 404; `Stripe` 200.
- The page's example, `curl https://swaggerbot.dev/api/lookup -H 'content-type: application/json' -d '{"name": "Stripe API"}'`, is Resolved, Official.

## Slice 5: the MCP server

### `7264d21` (2026-09-24): wave 1, `/mcp` with `lookup_api`

**Deployed at 11:46 CDT** (deployment `pxohytuty89ffymyigdepbez`). It carries #82 (WTR-129): `/mcp`, the MCP endpoint (`@modelcontextprotocol/server` 2.1.0, stateless), with `lookup_api` and the same key rules as `/api/lookup` (ADR 0005). No new env vars; the per-IP limit is shared with the HTTP API.

**Checked from outside** (11:47, Claude Code 2.1.281):
- `claude mcp add --transport http swaggerbot https://swaggerbot.dev/mcp` → "✔ Connected" in `claude mcp list`.
- `claude -p "Using only the swaggerbot MCP tools, find the Stripe API's Spec and give its download URL" --allowedTools "mcp__swaggerbot__*" --model haiku` answered with `stripe.com/stripe-api`, Official, and the `/api/specs/…/published` and `/normalized` URLs (33 s end to end). The published URL is 200 (6.6 MB).
- `GET /mcp` 405 (the SDK's stateless answer); an unknown bearer is 401 with `www-authenticate: Bearer`; `/api/health` OK.
- Until wave 2 (12:05), the Resolved text named `get_spec_outline`, which wasn't deployed yet.

### `3a41d89` (2026-09-24): wave 2, the other four tools

**Deployed at 12:05 CDT** (deployment `omrjavc50cvt5ceevnbcldk3`). It carries #83 (WTR-132, `list_vendor_apis`), #84 (WTR-130, `get_spec_outline` with `tag`, `query` and `cursor`, on HTTP too) and #85 (WTR-131, `get_operation` at 24 kB, `get_schema`, and `GET /api/apis/{apiId}/schema`). No new env vars. `/api/apis/{apiId}/outline` without parameters answers byte-for-byte as before (checked on a copy of the Index before merging).

**Live checks** (12:07, raw JSON-RPC to `https://swaggerbot.dev/mcp`, whole response):
- `tools/list`: `lookup_api`, `list_vendor_apis`, `get_spec_outline`, `get_operation`, `get_schema`.
- `get_spec_outline` Cloudflare, no filter: 26,966 B (76 operations, the 200 largest of its tags). Stripe with `query: "customers"`: 9,157 B.
- `get_operation` Stripe `POST /v1/customers`: 21,279 B, 12 schema references left for `get_schema`. Val Town `GET /v1/alias/{username}`: 1,897 B.
- `get_schema` Stripe `account`: 23,862 B. `list_vendor_apis` Jira: 1,643 B.

### `5acb32d` (2026-09-24): wave 3, `mcpcheck` and the docs

**Deployed at 12:25 CDT** (deployment `5siucceh1ddisnbc1vorxxy2`). It carries #86 (WTR-133): `scripts/mcpcheck.ts`, the README's MCP section, and the landing page's "Use it from Claude Code" block with `/mcp` in its route table. No new env vars.

**Live checks** (12:26): `mcpcheck https://swaggerbot.dev` PASS on the first run (largest 26.9 kB, slowest 543 ms), and with `--names "Val Town"` PASS; `formscheck` PASS (outline p90 190 ms, operation p90 319 ms, 0 non-2xx); `/` 200 with the new block. The acceptance run is in [`slice-5-result.md`](slices/slice-5-result.md).

### `f6b9bf3` (2026-09-24): WTR-134, the agent's guidance in `structuredContent`

**Deployed at 21:52 CDT** (deployment `pgytlt5bshjownjwxeoyipai`). It carries #87 (WTR-134, Slice 5 backlog #6, ADR 0005's amendment). Every successful MCP result's `structuredContent` now begins with `summary` and `next`, and all five tools declare an `outputSchema`. The HTTP API is unchanged. No new env vars.

**Live checks:**
- `mcpcheck` PASS: largest result 28.4 kB (`tools/list`, which now carries the output schemas), slowest call 701 ms.
- `formscheck` PASS: outline p90 207 ms, operation p90 380 ms, 0 non-2xx.
- Claude Code 2.1.282 on Haiku, asked to quote what production `lookup_api` returned, got a tool result beginning `{"summary":"Resolved: Stripe API by stripe.com, apiId "stripe.com/stripe-api". … Download the Spec: https://swaggerbot.dev/api/specs/…/published`.
- Watch: `tools/list` at 28.4 kB is near `mcpcheck`'s 30 kB bound. The Outcome's schema alone is 13.2 kB.

## Slice 6: the Web UI

### `9f35dbd` (2026-09-25): wave 1, the Vendor list and the UI plumbing

**Deployed at 02:07 CDT** (deployment `189ev757km2j3rselmodi9sn`). It carries #88 (WTR-137, `GET /api/vendors`) and #89 (WTR-136: Tailwind 4, shadcn, the security headers with a per-request script nonce, self-hosted fonts, `scripts/uicheck.ts`). The landing page looks as before. No new env vars.

**Live checks:**
- `/` carries `Content-Security-Policy` (`script-src 'self' 'nonce-…'`) and `X-Content-Type-Options: nosniff`; the API, `/mcp` and download responses don't.
- `GET /api/vendors?limit=3`: 3 of 21 Vendors, `nextCursor` `"3"`.
- `mcpcheck` PASS: largest result 28.4 kB, slowest call 577 ms.
- `formscheck` PASS: outline p90 299 ms, operation p90 355 ms, 0 non-2xx.

### `03d61f9` (2026-09-25): wave 2, the darkroom Search, Lookup result, Vendors and Spec viewer

**Deployed at 19:00 CDT** (deployment `9rpbhf1htcoxk8okchrsecpg`). It carries #90 (backlog O1: the darkroom shell and Search, `DESIGN.md`; the old landing page is retired), #91 (WTR-140: `/vendors` and `/vendors/{vendorId}`), #92 (WTR-138: `/lookup`, keyless, so only Index answers resolve) and #93 (WTR-139: `/specs/{specId}`, Scalar in a sandboxed frame from `/embed/specs/{specId}`). No new env vars.

**Live checks:**
- `uicheck` PASS on `/`, `/lookup?name=stripe`, `/vendors`, `/vendors/stripe.com` and the Stripe Spec viewer at 390 and 1280, light and dark: axe 0, CSP 0, keyboard complete on every page.
- `/embed/specs/…` carries `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; …`, and the Spec downloads carry `Access-Control-Allow-Origin: *` and `X-Content-Type-Options: nosniff`.
- `/vendors?cursor=10` answers 200, with no redirect.
- `mcpcheck` PASS: largest result 28.4 kB, slowest call 449 ms.
- `formscheck` PASS: outline p90 232 ms, operation p90 399 ms, 0 non-2xx.

## Gotchas

- Coolify's application health check runs `curl`/`wget` **inside** the container. An image without them is rolled back as unhealthy, even when its own Docker `HEALTHCHECK` passes.
- A deploy log can't be read with a token lacking `read:sensitive`. Read it on the server instead: `docker exec coolify php artisan tinker` → `ApplicationDeploymentQueue::where('deployment_uuid', …)->first()->logs`.
- Env values come back redacted without `read:sensitive`. To use them on the server, have tinker write them to a root-only file and shred it afterwards; they never need to leave the box.
- Cloudflare in front of `coolify.8gnc.com` rejects Python's default `urllib` User-Agent with **error 1010**. Send a normal User-Agent (curl's works) when scripting the API.
- The Coolify API rejects a project description containing `:` (422). It allows only letters, digits, spaces and `- _ . , ! ? ( ) ' " + = * / @ &`.
- The `coolify` CLI's `app get --format json` printed nothing here. Use the REST API (`/api/v1/applications/<uuid>`) to read an app back.
