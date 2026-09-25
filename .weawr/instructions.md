# swagger.bot

swagger.bot turns the name of an API into a verified OpenAPI/Swagger Spec with its Provenance, or says honestly why it can't. Read `docs/PRD.md` (what to build), `CONTEXT.md` (the glossary: use its terms exactly in code, types and docs) and `docs/adr/` (decisions already made) before you start. Your issue is one item of `docs/slices/slice-6-backlog.md` (earlier slices: `slice-1-backlog.md` with its tuning round in `slice-1-tuning.md`, `slice-2-backlog.md`, `slice-3-backlog.md`, `slice-4-backlog.md` and `slice-5-backlog.md`); the table there shows what it builds on and what comes after it.

One TanStack Start app, TypeScript throughout, pnpm, Node 24. Layout (create folders as your issue needs them):
- `src/domain/`: zod schemas and types for the glossary (Vendor, API, Spec, Source, Provenance, Outcome).
- `src/index-store/`: the Index in SQLite through Drizzle (`db.ts`, `schema.ts`, `repo.ts`); migrations in `drizzle/`.
- `src/judge/`: the Judge interface, the Jev adapter and the fake judge.
- `src/fetch/`: the polite fetcher, Spec sniffing, known-path probe.
- `src/sources/`: APIs.guru, web search, portal finding, GitHub, the Developer Portal crawl.
- `src/lookup/`: the Lookup pipeline and thresholds.
- `src/benchmark/` and `benchmark/entries.json`: the Benchmark and its runner. `scripts/`: CLI entry points run with `pnpm tsx`.

## Build and checks
- Install: `pnpm install`
- Before opening the PR, all green: `pnpm check` (Biome lint, `tsc --noEmit`, `vitest run`) and `pnpm build`. Until the scaffold issue lands, there is nothing to run; that issue creates these scripts.
- Tests are colocated as `src/**/*.test.ts`. No test may call a real external service (TypeSafe, Brave, Tavily, APIs.guru, any website). Fake them: the fake judge, a fake WebSearch, fixtures under `src/**/__fixtures__/`, or a local `node:http` server on port 0.
- Env vars (never commit values): `TYPESAFE_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SEARCH_PROVIDER`, `DATABASE_PATH`, `GITHUB_SEARCH_TOKEN` (repo metadata works without it; GitHub code search does not); from Slice 3 also `PORT`, `FRESHNESS_DAYS`, `DAILY_QUOTA`, `RATE_LIMIT_PER_MINUTE`, `CLIENT_IP_HEADER` and the `LITESTREAM_*` backup settings (see `docs/slices/slice-3-backlog.md`); from Slice 4 also `MAX_FORMS_BYTES` and `PUBLIC_BASE_URL` (see `docs/slices/slice-4-backlog.md`). Your worktree has no keys and needs none; live smoke scripts are for the reviewer.

## Rules
- One branch per issue; open a PR against `main`; never merge it yourself. Put `Closes WTR-<n>` in the PR description.
- Do only what your issue says. If it depends on code from an earlier issue that isn't on `main`, stop and say so rather than building it yourself.
- Add only the dependencies your issue names, plus dev tooling the issue implies (types packages, `tsx`). Anything else, ask. `@modelcontextprotocol/server` is added only by Slice 5's issue #1 (the `/mcp` endpoint); later issues use it, they don't add it again. Slice 6 (the Web UI): `tailwindcss`, `@tailwindcss/vite`, shadcn's generated components and their Radix dependencies, `playwright` and `@axe-core/playwright` are added only by its issue #1, and `@scalar/api-reference` only by its issue #4; later issues use them. UI work follows `PRODUCT.md` and `DESIGN.md` at the repo root and the screen's brief under `docs/design/`.
- Don't edit `docs/PRD.md`, `CONTEXT.md`, `docs/adr/` or `.claude/`. If your work shows the design is wrong or silent, say so in the PR description.
- Never commit `.env`, `.env.local`, `data/` or a database file.
- If the issue leaves a real decision open, ask (a question in chat, or needs_human in the result) rather than guess.
