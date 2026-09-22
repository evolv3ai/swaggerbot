---
status: accepted
---

# Single-instance TanStack Start app on Coolify, with SQLite and Litestream

swagger.bot ships as one TanStack Start application — HTTP API, MCP endpoint and web UI together — deployed as a single instance on Coolify, with the Index in SQLite (WAL mode, via Drizzle) on a Coolify volume and continuously replicated to Cloudflare R2 with Litestream. This replaces the PRD's Express + separate React/Vite app + self-hosted MongoDB. We chose SQLite over Neon because most Lookups are answered from the Index and must be near-instant, which an in-process database gives and a remote serverless one (network hop, cold starts after idle) does not; Neon's strengths (horizontal scale, branching) solve problems we don't have.

## Consequences

- The app must run as exactly one instance (single SQLite writer). Scaling out means moving to Postgres first; Drizzle is chosen to keep that move cheap.
- Background Verification runs in-process, queued in a SQLite table.
- Backup and restore are our responsibility via Litestream; restore must be rehearsed before launch.
