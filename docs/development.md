# Development

How the repository is laid out, what to run before opening a PR and which environment variables exist. Read [`docs/PRD.md`](PRD.md) (what to build), [`CONTEXT.md`](../CONTEXT.md) (the glossary: use its terms exactly in code, types and docs) and [`docs/adr/`](adr/) (decisions already made) before you start. Each slice's issues and results are in [`docs/slices/`](slices/).

One TanStack Start app, TypeScript throughout, pnpm, Node 24 (the pnpm version is pinned in `package.json`; `corepack enable` picks it up).

## Layout

- `src/domain/`: zod schemas and types for the glossary (Vendor, API, Spec, Source, Provenance, Outcome).
- `src/index-store/`: the Index in SQLite through Drizzle (`db.ts`, `schema.ts`, `repo.ts`), the key stores (`keys.ts`, `unkey-keys.ts`), the Spec forms table and Ask this Spec's meter and turn log (`chat.ts`); migrations in `drizzle/`.
- `src/judge/`: the Judge interface, the Jev adapter and the fake judge.
- `src/fetch/`: the polite fetcher, Spec sniffing, known-path probe.
- `src/sources/`: APIs.guru, web search, portal finding, GitHub, the Developer Portal crawl.
- `src/lookup/`: the Lookup pipeline, thresholds and the HTTP API (`http.ts`, wired in `app.ts`).
- `src/spec-forms/`: the Normalized Form, Validity Issues and Spec Outline builder (the only place that may import Scalar, [ADR 0004](adr/0004-normalized-form-built-in-background-with-scalar.md); Biome enforces it).
- `src/mcp/`: the MCP server over the same code ([ADR 0005](adr/0005-mcp-in-process-with-agent-sized-results.md)).
- `src/chat/`: Ask this Spec (Slice 9): `retrieve.ts` picks a question's grounding from the Normalized Form and the Spec Outline, pure code with no model and no Index (`words.ts` is the tokenizer and stop list it shares with the chat Benchmark); the `Model` seam, the Anthropic adapter (`anthropic.ts`, the only file that may import `@anthropic-ai/sdk`; Biome enforces it), `FakeModel` for tests and the system prompt. The route is `src/server/chat.ts`.
- `src/routes/`, `src/components/`, `src/styles/`, `src/lib/`: the web UI (TanStack Start routes, shadcn components, Tailwind 4 theme); `src/server/`: request middleware such as the security headers.
- `src/benchmark/` and `benchmark/entries.json`: the Benchmark and its runner, plus the deployment checks' code; `benchmark/chat.json` is the chat Benchmark `chatcheck` asks.
- `scripts/`: CLI entry points run with `pnpm tsx` (`bench.ts`, `keys.ts`, `chatstats.ts`, the `*check.ts` deployment checks, `lookup.ts`). The README documents each. `pnpm tsx scripts/chat-retrieve.ts [--text] <normalized.json> "<question>"` prints what an "Ask this Spec" turn would send the model for that question, with each document's bytes, without calling one; `<normalized.json>` is a Normalized Form, for example a Spec's `normalized_bytes` copied out of a copy of the Index with `sqlite3 index.db "select writefile('normalized.json', normalized_bytes) from spec_forms where spec_id = '<specId>'"`.
- `src/cli/`: the public `swaggerbot` CLI (Slice 8), a client of the HTTP API only: it may import types from `src/domain/` and nothing from the server (Biome enforces it).
- `cli/`: the npm package around that CLI (`package.json`, `README.md`, `CHANGELOG.md`); `pnpm build:cli` bundles `src/cli/bin.ts` into `cli/dist/swaggerbot.mjs`, which is ignored by git.
- `docker/` and `Dockerfile`: the production image and its Litestream entrypoint ([`docs/deploy.md`](deploy.md)).

UI work follows `PRODUCT.md` and `DESIGN.md` at the repo root.

## Build and checks

- Install: `pnpm install`
- Before opening a PR, all green: `pnpm check` (Biome lint, `tsc --noEmit`, `vitest run`) and `pnpm build` (the app, the operator CLI and, through `pnpm build:cli`, the public CLI bundle). CI (`.github/workflows/ci.yml`) runs the same on every PR and push to `main`, then starts the bundle with `--version`.
- Releasing the CLI: bump `cli/package.json`, add the changelog entry to `cli/CHANGELOG.md`, tag `cli-v<version>` and push the tag; [`scripts/release-cli.md`](../scripts/release-cli.md) has the steps.
- Tests are colocated as `src/**/*.test.ts` (`vitest.config.ts` looks nowhere else). No test may call a real external service (TypeSafe, Brave, Tavily, APIs.guru, Unkey, WorkOS, Anthropic, any website). Fake them: the fake judge, a fake WebSearch, fake Unkey and WorkOS clients, `FakeModel` (or a fake SDK client for the adapter), fixtures under `src/**/__fixtures__/`, or a local `node:http` server on port 0. Ask this Spec's tests use `FakeModel` or a scripted `Model`; the only thing that calls the real model is `scripts/chatcheck.ts`, an operator step that spends money and the signed-in person's questions for the day (`CHAT_FAKE=1` runs it against a local build with the chat Benchmark's scripted model instead). `uicheck`'s tests drive a headless Chromium: install it once with `pnpm exec playwright install chromium`.
- Add a dependency only when the work needs it, and say so in the PR.
- Don't edit `docs/PRD.md`, `CONTEXT.md` or `docs/adr/` as part of a change. If the work shows the design is wrong or silent, say so in the PR description.
- Never commit `.env`, `.env.local`, `data/` or a database file.

## Environment variables

Never commit values; `.env.example` lists each with a comment, and `cp .env.example .env` is the start. None is required for the tests or for `pnpm dev` with the Index alone; without the Unkey and WorkOS ones the app runs with keys in SQLite and no sign-in.

- Lookup: `TYPESAFE_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SEARCH_PROVIDER`, `DATABASE_PATH`, `GITHUB_SEARCH_TOKEN` (repo metadata works without it; GitHub code search does not; `GITHUB_TOKEN` is read as a fallback), `MAX_SPEC_BYTES`, `SPEC_STEP_BUDGET_MS`.
- Serving: `PORT`, `FRESHNESS_DAYS`, `DAILY_QUOTA`, `RATE_LIMIT_PER_MINUTE`, `CLIENT_IP_HEADER`, `PUBLIC_BASE_URL`, `MAX_FORMS_BYTES`.
- Backups, container only: the `LITESTREAM_*` settings read by `docker/entrypoint.sh` (the README's "Running in production" table).
- Ask this Spec: `ANTHROPIC_API_KEY` (unset, the feature is off), `CHAT_MODEL`, `CHAT_EFFORT`, `CHAT_DAILY_TURNS` (questions a signed-in person may ask a UTC day, default 30), `CHAT_LOG_TEXT=1` (keep each turn's question and answer for a tuning period), `CHAT_FAKE=1` (with no `ANTHROPIC_API_KEY`: with no WorkOS, local checks only, the chat Benchmark's scripted model answers, as one stand-in person; with WorkOS, development only and refused under `NODE_ENV=production`, turns are answered by a scripted model, `devFakeModel` in `src/chat/fake.ts`, so the panel can be tried signed in without a key; a question starting "Call", "Fetch" or "Run" is declined). `pnpm tsx scripts/chatstats.ts [--since YYYY-MM-DD]` reports the logged turns, people, tokens and an estimated cost.
- Self-service keys ([ADR 0006](adr/0006-keys-in-unkey-accounts-in-workos.md)): `UNKEY_ROOT_KEY`, `UNKEY_API_ID`, `UNKEY_KEYSPACE_ID`, `UNKEY_MIGRATION_ID`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`.
- Diagnostics and the deployment checks: `LOOKUP_TRACE=1` (per-step timings on every Lookup), `LOOKUP_FULL` (`scripts/lookup.ts` prints the whole Outcome), `LOADCHECK_KEY` and `KEYCHECK_KEY` (the bearer the `*check.ts` scripts send), `CHATCHECK_COOKIE` (the signed-in browser's `Cookie` header `chatcheck` sends).
