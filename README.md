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
pnpm bench [--only-reviewed] [--json] [--search brave|tavily] [--concurrency <n>]
```

Runs every Benchmark entry through the live Lookup and prints the False Resolution rate, long-tail coverage and Outcome accuracy; it exits 1 when the False Resolution rate reaches the 2% gate. It needs the same keys as a Lookup (`TYPESAFE_API_KEY`, plus a search key for portal finding).

A run uses a throwaway Index by default: a fresh, empty database in a temporary directory, deleted when the run ends. Without it, names the Index had already settled would be answered from the Index, and the Benchmark would measure Index replay instead of Discovery. Two flags change this:

- `--index <path>` uses the Index at that path and never deletes it, for comparing runs or inspecting what was stored.
- `--keep-index` keeps the temporary Index and prints its path.

They can't be used together. The report names the Index it used (`indexPath` and `indexFresh` in `--json`).

Under the header a latency line gives the p50, p90 and max time per answer, e.g. `Latency (Discovery): p50 9.8 s · p90 31.2 s · max 57.5 s (n=40)` (`latency` in `--json`, in ms). With a fresh Index every answer is a Discovery; with `--index`, some came from the Index, and the line says so. `--concurrency <n>` runs n Lookups at once (default 4); `--concurrency 1` measures latency without Lookups competing for the fetcher's per-host spacing. The run traces each Lookup (`LOOKUP_TRACE=1`), so in `--json` every answer's Outcome carries `timings`: milliseconds per Lookup step (`APIs.guru`, `Judge whichApi`, `Developer Portal search`, `known paths`, `Developer Portal crawl`, `GitHub code search`, `Spec fetch` and so on), a step that ran more than once adding up.

## Crawling etiquette

The fetcher (`src/fetch/fetcher.ts`) sends an honest User-Agent, spaces requests per host and respects `robots.txt`. The one exception is [ADR 0003](docs/adr/0003-robots-txt-exception-for-vendor-linked-specs.md): a single Spec document linked from an allowed Vendor page is fetched once even when its own host's `robots.txt` disallows it (`fetchUrl(url, { ignoreRobots: true })`), and never crawled on from; the result's `robotsDisallowed` records that it happened. The same holds for a Spec at a known path on the Vendor's own API host when that host's `robots.txt` disallows its whole site (`Disallow: /`, as an app host like `api.val.town` does): the known-path probe retries that one path once with `ignoreRobots`, but only for the Vendor's own domain and never when `robots.txt` merely lists disallowed paths (Codeberg's `/swagger.*.json`) or could not be fetched. Either way the Lookup adds a diagnostic naming the URL.

It also caps a fetched body at 64 MB, counted as it streams in (after decompression) and aborted the moment it passes the cap, so an enormous response is never buffered whole. Set `MAX_SPEC_BYTES` (in bytes) to change the cap; a value that is not a positive integer is ignored with a warning.

## Check

```sh
pnpm check   # Biome lint, tsc --noEmit, vitest run; stops at the first failure
```

The same `pnpm check` and `pnpm build` run in CI (`.github/workflows/ci.yml`) on every PR and push to `main`.
