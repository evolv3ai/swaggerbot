---
status: accepted
---

# Single-instance TanStack Start app on Coolify, with SQLite and Litestream

swagger.bot ships as one TanStack Start application — HTTP API, MCP endpoint and web UI together — deployed as a single instance on Coolify, with the Index in SQLite (WAL mode, via Drizzle) on a Coolify volume and continuously replicated to object storage with Litestream (Cloudflare R2 as first written; Backblaze B2 since 2026-09-22, see the amendment below). This replaces the PRD's Express + separate React/Vite app + self-hosted MongoDB. We chose SQLite over Neon because most Lookups are answered from the Index and must be near-instant, which an in-process database gives and a remote serverless one (network hop, cold starts after idle) does not; Neon's strengths (horizontal scale, branching) solve problems we don't have.

## Consequences

- The app must run as exactly one instance (single SQLite writer). Scaling out means moving to Postgres first; Drizzle is chosen to keep that move cheap.
- Background Verification runs in-process, queued in a SQLite table.
- Backup and restore are our responsibility via Litestream; restore must be rehearsed before launch.

## Amendment, 2026-09-22: Backblaze B2 instead of R2

Wes chose Backblaze B2 for the Litestream replica when Slice 3 was planned. Litestream writes to B2 through its S3-compatible endpoint (`type: s3` with a B2 `endpoint`), so nothing else in this decision changes. The replica is one private bucket with an application key restricted to it.
