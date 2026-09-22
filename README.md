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
pnpm build   # production build into dist/
```

## Benchmark

```sh
pnpm bench [--only-reviewed] [--json] [--search brave|tavily]
```

Runs every Benchmark entry through the live Lookup and prints the False Resolution rate, long-tail coverage and Outcome accuracy; it exits 1 when the False Resolution rate reaches the 2% gate. It needs the same keys as a Lookup (`TYPESAFE_API_KEY`, plus a search key for portal finding).

A run uses a throwaway Index by default: a fresh, empty database in a temporary directory, deleted when the run ends. Without it, names the Index had already settled would be answered from the Index, and the Benchmark would measure Index replay instead of Discovery. Two flags change this:

- `--index <path>` uses the Index at that path and never deletes it, for comparing runs or inspecting what was stored.
- `--keep-index` keeps the temporary Index and prints its path.

They can't be used together. The report names the Index it used (`indexPath` and `indexFresh` in `--json`).

## Check

```sh
pnpm check   # Biome lint, tsc --noEmit, vitest run; stops at the first failure
```

The same `pnpm check` and `pnpm build` run in CI (`.github/workflows/ci.yml`) on every PR and push to `main`.
