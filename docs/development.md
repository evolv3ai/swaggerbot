# Development

How the repository is laid out, what to run before opening a PR and which environment variables exist. Read [`docs/PRD.md`](PRD.md) (what to build), [`CONTEXT.md`](../CONTEXT.md) (the glossary: use its terms exactly in code, types and docs) and [`docs/adr/`](adr/) (decisions already made) before you start. Each slice's issues and results are in [`docs/slices/`](slices/).

One TanStack Start app, TypeScript throughout, pnpm, Node 24 (the pnpm version is pinned in `package.json`; `corepack enable` picks it up).

## Layout

- `src/domain/`: zod schemas and types for the glossary (Vendor, API, Spec, Source, Provenance, Outcome).
- `src/index-store/`: the Index in SQLite through Drizzle (`db.ts`, `schema.ts`, `repo.ts`), the key stores (`keys.ts`, `unkey-keys.ts`) and the Spec forms table; migrations in `drizzle/`.
- `src/judge/`: the Judge interface, the Jev adapter and the fake judge.
- `src/fetch/`: the polite fetcher, Spec sniffing, known-path probe.
- `src/sources/`: APIs.guru, web search, portal finding, GitHub, the Developer Portal crawl.
- `src/lookup/`: the Lookup pipeline, thresholds and the HTTP API (`http.ts`, wired in `app.ts`).
- `src/spec-forms/`: the Normalized Form, Validity Issues and Spec Outline builder (the only place that may import Scalar, [ADR 0004](adr/0004-normalized-form-built-in-background-with-scalar.md); Biome enforces it).
- `src/mcp/`: the MCP server over the same code ([ADR 0005](adr/0005-mcp-in-process-with-agent-sized-results.md)).
- `src/routes/`, `src/components/`, `src/styles/`, `src/lib/`: the web UI (TanStack Start routes, shadcn components, Tailwind 4 theme); `src/server/`: request middleware such as the security headers.
- `src/benchmark/` and `benchmark/entries.json`: the Benchmark and its runner, plus the deployment checks' code.
- `scripts/`: CLI entry points run with `pnpm tsx` (`bench.ts`, `keys.ts`, the `*check.ts` deployment checks, `lookup.ts`). The README documents each.
- `docker/` and `Dockerfile`: the production image and its Litestream entrypoint ([`docs/deploy.md`](deploy.md)).

UI work follows `PRODUCT.md` and `DESIGN.md` at the repo root.

## Build and checks

- Install: `pnpm install`
- Before opening a PR, all green: `pnpm check` (Biome lint, `tsc --noEmit`, `vitest run`) and `pnpm build`. CI (`.github/workflows/ci.yml`) runs the same on every PR and push to `main`.
- Tests are colocated as `src/**/*.test.ts` (`vitest.config.ts` looks nowhere else). No test may call a real external service (TypeSafe, Brave, Tavily, APIs.guru, Unkey, WorkOS, any website). Fake them: the fake judge, a fake WebSearch, fake Unkey and WorkOS clients, fixtures under `src/**/__fixtures__/`, or a local `node:http` server on port 0. `uicheck`'s tests drive a headless Chromium: install it once with `pnpm exec playwright install chromium`.
- Add a dependency only when the work needs it, and say so in the PR.
- Don't edit `docs/PRD.md`, `CONTEXT.md` or `docs/adr/` as part of a change. If the work shows the design is wrong or silent, say so in the PR description.
- Never commit `.env`, `.env.local`, `data/` or a database file.

## Environment variables

Never commit values; `.env.example` lists each with a comment, and `cp .env.example .env` is the start. None is required for the tests or for `pnpm dev` with the Index alone; without the Unkey and WorkOS ones the app runs with keys in SQLite and no sign-in.

- Lookup: `TYPESAFE_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SEARCH_PROVIDER`, `DATABASE_PATH`, `GITHUB_SEARCH_TOKEN` (repo metadata works without it; GitHub code search does not; `GITHUB_TOKEN` is read as a fallback), `MAX_SPEC_BYTES`, `SPEC_STEP_BUDGET_MS`.
- Serving: `PORT`, `FRESHNESS_DAYS`, `DAILY_QUOTA`, `RATE_LIMIT_PER_MINUTE`, `CLIENT_IP_HEADER`, `PUBLIC_BASE_URL`, `MAX_FORMS_BYTES`.
- Backups, container only: the `LITESTREAM_*` settings read by `docker/entrypoint.sh` (the README's "Running in production" table).
- Self-service keys ([ADR 0006](adr/0006-keys-in-unkey-accounts-in-workos.md)): `UNKEY_ROOT_KEY`, `UNKEY_API_ID`, `UNKEY_KEYSPACE_ID`, `UNKEY_MIGRATION_ID`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`.
- Diagnostics and the deployment checks: `LOOKUP_TRACE=1` (per-step timings on every Lookup), `LOOKUP_FULL` (`scripts/lookup.ts` prints the whole Outcome), `LOADCHECK_KEY` and `KEYCHECK_KEY` (the bearer the `*check.ts` scripts send).
