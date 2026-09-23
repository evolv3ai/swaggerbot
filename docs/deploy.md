# Deploying swagger.bot

The operator runbook for the live service ([Slice 3](slices/slice-3-backlog.md), ADR 0002). swagger.bot runs as one container on Coolify. The Index is a SQLite file on a local Docker volume, replicated continuously to Backblaze B2 by Litestream. This page records what exists and how it was made, so a restore or a rebuild can follow it. Secrets never go in this file: it names where they live.

## What exists

| Thing | Where |
|---|---|
| Coolify | `https://coolify.8gnc.com` (v4.3.23), on the Contabo server `cbo-01-217-110` (`217.216.90.110`, SSH alias `cbo-01-217-110`, user `admin` with sudo) |
| CLI access | `coolify --context 8gnc …`. The API token is `claude-swaggerbot` (abilities read, write, deploy), stored only in `~/.config/coolify/config.json` on WOPR3's WSL. Revoke it in Coolify under Keys & Tokens. |
| Project | `swaggerbot` (`sk3lxvcsepxflz8srxm1vzm6`), environment `production` |
| Application | `swaggerbot` (`z1hr4xe7sa8ni5s5zbryey6y`), public repo `evolv3ai/swaggerbot`, branch `main`, Dockerfile build pack, port 3000, health check `/api/health`, memory limit 2 GB, domain `https://swaggerbot.dev` |
| Volume | `z1hr4xe7sa8ni5s5zbryey6y-swaggerbot-data` mounted at `/app/data` (a local named volume; SQLite must not sit on a network filesystem) |
| Backup | B2 bucket `swaggerbot-litestream` (private, account endpoint `s3.us-east-005.backblazeb2.com`). A lifecycle rule deletes hidden file versions after 1 day, so Litestream's own retention decides what is kept. Replica path `swaggerbot`. |
| B2 key | application key `swaggerbot-litestream`, restricted to that bucket (listBuckets, listFiles, readFiles, writeFiles, deleteFiles). Its secret exists only in Coolify's env vars. |
| DNS | `swaggerbot.dev` at Namecheap (BasicDNS). |

**Environment variables set in Coolify** (values in Coolify only): `LITESTREAM_BUCKET`, `LITESTREAM_PATH`, `LITESTREAM_ENDPOINT` (the full `https://` URL), `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`, `TYPESAFE_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY` and `GITHUB_SEARCH_TOKEN`. The app keys were copied from the repo's local `.env` and `.env.local`. `DATABASE_PATH` comes from the Dockerfile (`/app/data/swaggerbot.db`). Coolify keeps a preview copy of each variable; preview deployments are off.

## Steps

- [x] **O1. B2 bucket and key** (2026-09-23). `b2 bucket create --default-server-side-encryption SSE-B2 --lifecycle-rule '{"daysFromHidingToDeleting":1,…}' swaggerbot-litestream allPrivate`, then `b2 key create --bucket swaggerbot-litestream swaggerbot-litestream listBuckets,listFiles,readFiles,writeFiles,deleteFiles`. The key went straight into Coolify without being printed.
- [x] **O2. Coolify app** (2026-09-23): project, app, volume and env vars as above, through the Coolify API. It is **not deployed**: there is no Dockerfile until WTR-89 merges.
- [ ] **O3. DNS.** At Namecheap: `A @ → 217.216.90.110`. Coolify's Traefik takes 80/443 on that server directly (ufw allows both) and gets a Let's Encrypt certificate once the name resolves. There's no Cloudflare tunnel for this domain.
- [ ] **O4. First deploy**, after WTR-89: `coolify deploy uuid z1hr4xe7sa8ni5s5zbryey6y --context 8gnc`. Check `https://swaggerbot.dev/api/health`, and that the Litestream generation appears in the bucket (`b2 ls b2://swaggerbot-litestream/swaggerbot/`). Issue a key for the load check with `scripts/keys.ts` inside the container, after WTR-90.
- [ ] **O5. Restore rehearsal.** Restore the replica into a scratch path, compare row counts and a Lookup against the live database, then restore into a fresh volume and boot the app from it.
- [ ] **O6. Load check**, after WTR-93: `scripts/loadcheck.ts https://swaggerbot.dev`. The numbers go in `docs/slices/slice-3-result.md`.

## Gotchas

- Cloudflare in front of `coolify.8gnc.com` rejects Python's default `urllib` User-Agent with **error 1010**. Send a normal User-Agent (curl's works) when scripting the API.
- The Coolify API rejects a project description containing `:` (422). It allows only letters, digits, spaces and `- _ . , ! ? ( ) ' " + = * / @ &`.
- The `coolify` CLI's `app get --format json` printed nothing here. Use the REST API (`/api/v1/applications/<uuid>`) to read an app back.
