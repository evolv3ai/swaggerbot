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

**Environment variables set in Coolify** (values in Coolify only): `LITESTREAM_BUCKET`, `LITESTREAM_PATH`, `LITESTREAM_ENDPOINT` (the full `https://` URL), `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`, `TYPESAFE_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `GITHUB_SEARCH_TOKEN` and `CLIENT_IP_HEADER=cf-connecting-ip` (the proxy is Cloudflare; read once WTR-92 lands). The app keys were copied from the repo's local `.env` and `.env.local`. `DATABASE_PATH` comes from the Dockerfile (`/app/data/swaggerbot.db`). Coolify keeps a preview copy of each variable; preview deployments are off.

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
  **Gotcha:** the app needs its API keys (`TYPESAFE_API_KEY` and the rest) even to serve Index answers, because `createApp` builds the Judge on the first request. Booted without them, every Lookup returns 500.
- [x] **O6. Load check** (2026-09-23, image `b7c880b`): `set -a; . ./.env.local; set +a; pnpm tsx scripts/loadcheck.ts https://swaggerbot.dev --json` (the key comes from `LOADCHECK_KEY`). **Index p90 80 ms; Discovery p90 14.2 s, and 12.3 s on a second run.** Both pass. Details are in [`slices/slice-3-result.md`](slices/slice-3-result.md). A full run uses one quota unit per Benchmark entry (40).

## Gotchas

- Coolify's application health check runs `curl`/`wget` **inside** the container. An image without them is rolled back as unhealthy, even when its own Docker `HEALTHCHECK` passes.
- A deploy log can't be read with a token lacking `read:sensitive`. Read it on the server instead: `docker exec coolify php artisan tinker` → `ApplicationDeploymentQueue::where('deployment_uuid', …)->first()->logs`.
- Env values come back redacted without `read:sensitive`. To use them on the server, have tinker write them to a root-only file and shred it afterwards; they never need to leave the box.
- Cloudflare in front of `coolify.8gnc.com` rejects Python's default `urllib` User-Agent with **error 1010**. Send a normal User-Agent (curl's works) when scripting the API.
- The Coolify API rejects a project description containing `:` (422). It allows only letters, digits, spaces and `- _ . , ! ? ( ) ' " + = * / @ &`.
- The `coolify` CLI's `app get --format json` printed nothing here. Use the REST API (`/api/v1/applications/<uuid>`) to read an app back.
