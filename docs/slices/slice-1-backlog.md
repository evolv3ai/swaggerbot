# Slice 1 backlog: Benchmark and core Lookup

The issues for [Slice 1](../PRD.md#slice-1--benchmark-and-core-lookup), written so the weawr factory can build them: each body is filed as-is on Linear (team WTR, labels `ai` + `swaggerbot`). Capitalised terms are from [`CONTEXT.md`](../../CONTEXT.md). Conventions shared by every issue (layout, env vars, the gate) live in `.weawr/instructions.md`, which every agent reads.

## Order

Filed 2026-09-22 as WTR-24..33, with Linear "blocked by" relations mirroring this table. An issue moves from Backlog to Agent Todo only when everything it depends on is merged.

| # | Linear | Issue | Depends on | Wave |
|---|---|---|---|---|
| 1 | WTR-24 | Scaffold the app and the check gate | — | 1 |
| 2 | WTR-25 | Domain types and the Index schema | 1 | 2 |
| 5 | WTR-28 | Polite fetcher, known-path probe and Spec sniffing | 1 | 2 |
| 3 | WTR-26 | Benchmark format and runner | 2 | 3 |
| 4 | WTR-27 | Judge interface, Jev adapter and fake judge | 2 | 3 |
| 6 | WTR-29 | APIs.guru Source | 2 | 3 |
| 7 | WTR-30 | WebSearch interface and Brave adapter | 2 | 3 |
| 9 | WTR-33 | Benchmark seed: about 40 entries | 3 | 4 |
| 7b | WTR-31 | Tavily adapter | 7 | 4 |
| 8 | WTR-32 | Lookup pipeline and `POST /api/lookup` | 3, 4, 5, 6, 7 | 5 |

After #8 merges, the Slice 1 acceptance run (`pnpm bench` live, reviewed entries only) and threshold tuning are done by hand, not by the factory.

---

## 1. swaggerbot: scaffold the app and the check gate

## Problem
The repo holds only design docs (`docs/PRD.md`, `CONTEXT.md`, `docs/adr/`). There is no app, no test runner and no CI, so no later issue has anything to build on or a gate to pass.

## Change
Create a TanStack Start app (React, TypeScript) at the repo root, following ADR 0002:
- pnpm, Node 24. `package.json` `engines.node` = `>=24`, `packageManager` pinned to the installed pnpm.
- TypeScript `strict: true`, path alias `~/*` → `src/*`.
- Biome for lint and format (`biome.json`, 2-space indent, double quotes). No ESLint or Prettier.
- Vitest for tests, colocated as `src/**/*.test.ts`.
- Drizzle ORM with `better-sqlite3`. `src/index-store/db.ts` exports `openDb(path)`, which opens the file, sets `journal_mode = WAL` and `foreign_keys = ON`, and returns the Drizzle instance. The path comes from `DATABASE_PATH`, default `./data/swaggerbot.db`; `data/` is gitignored and created if missing. No tables yet (#2 adds them). `drizzle.config.ts` points migrations at `drizzle/`.
- Scripts: `dev`, `build`, `lint` (`biome check .`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), and `check` = lint + typecheck + test, which stops at the first failure.
- A server route `GET /api/health` returns `200 {"ok":true}`.
- `.env.example` lists `TYPESAFE_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SEARCH_PROVIDER`, `DATABASE_PATH`, with no values. Keep the existing `.gitignore` entries and add build output and `data/`.
- GitHub Actions `.github/workflows/ci.yml`: on push to main and on PRs, Node 24 + pnpm, `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`.
- Replace the placeholder home page with one line: "swagger.bot: coming soon". No styling work (the UI is Slice 6).
- `README.md`: what the project is (one paragraph, linking `docs/PRD.md`), how to install, run and check.

Do not delete or edit the files in `docs/`, `CONTEXT.md` or `.claude/`.

## Done when
- `src/index-store/db.test.ts` opens a temp-file database and asserts `journal_mode` is `wal` and foreign keys are on.
- A test calls the `/api/health` handler and gets `{"ok":true}` (call the handler directly; no server process).
- `pnpm check` and `pnpm build` are green locally, and the CI workflow file runs the same commands.
- `README.md` written as above.

---

## 2. swaggerbot: domain types and the Index schema

## Problem
Nothing in `src/` models the vocabulary in `CONTEXT.md`, and the SQLite database from #1 has no tables, so there is nowhere to store a Vendor, API, Spec or Source, and no shared types for Outcomes.

## Change
**Types** in `src/domain/` (zod schemas with inferred types, one file per group):
- `catalog.ts`: `Vendor {id, name, domain}`, `Api {id, vendorId, name}`, `Spec {id, apiId, specVersion ("2.0" | "3.0.x" | "3.1.x" as a string), apiVersion (string | null), format ("json" | "yaml"), byteLength}`, `Source {id, specId, url, provenance, firstSeenAt, lastVerifiedAt}`.
- `provenance.ts`: `Provenance = "Official" | "Endorsed" | "Mirror" | "Community"` with an ordering helper `bestProvenance(list)`.
- `outcome.ts`: a discriminated union on `outcome`: `Resolved {api, vendor, currentSpec, alternateSpecs, provenance, sources, validityIssues: [], verifiedAt}`, `Ambiguous {candidates: {apiId?, name, vendor?, probability}[]}`, `Unconfirmed {api, vendor, spec, sources, reasons: string[], verifiedAt}`, `NoSpec {api, vendor, communityAvailable: boolean}`, `Unknown {name}`.

IDs: a Vendor id is a lowercase slug of its main domain (`stripe.com`). An API id is `<vendorId>/<api-slug>` (`stripe.com/stripe-api`). A Spec id is the lowercase hex sha256 of its Published Form bytes, so identical content from two Sources is one Spec.

**Schema** in `src/index-store/schema.ts` (Drizzle, SQLite), with a migration generated by drizzle-kit and committed in `drizzle/`:
- `vendors`, `apis` (FK vendor), `specs` (FK api, plus a `published_bytes` BLOB), `sources` (FK spec, `url` unique per spec), and `api_names` (`name_normalized` → `api_id`), so a later Lookup of the same name is answered from the Index.
- Timestamps are ISO-8601 text in UTC.

**Repository** in `src/index-store/repo.ts`, all synchronous (better-sqlite3): `upsertVendor`, `upsertApi`, `putSpec(apiId, bytes, meta)` (returns the Spec; idempotent on the sha256), `addSource(specId, url, provenance)` (idempotent on the url), `rememberName(name, apiId)`, `findApiByName(name)`, `getApiWithSpecs(apiId)`. `normalizeName(name)` lowercases, trims, collapses whitespace and strips a trailing " api"; it is exported and tested.

`openDb` from #1 runs pending migrations on open.

No new dependencies beyond `zod` and `drizzle-kit` (dev).

## Done when
- `src/index-store/repo.test.ts` runs against a temp database: the upserts are idempotent, `putSpec` with the same bytes twice yields one row, a Source's provenance round-trips, and `findApiByName("Stripe API ")` finds a name remembered as "stripe".
- `src/domain/*.test.ts`: each Outcome variant parses, an invalid one is rejected, and `bestProvenance(["Mirror","Official"])` is `"Official"`.
- `pnpm check` green.

---

## 3. swaggerbot: Benchmark format and runner

## Problem
The PRD's release gate is a False Resolution rate below 2% on the Benchmark, but there is no Benchmark format and no way to measure a Lookup against it.

## Change
- `benchmark/entries.json`: a JSON array. The entry schema (zod) goes in `src/benchmark/entry.ts`:
  `{ name: string, group: "popular" | "longtail" | "ambiguous" | "negative", expected: "Resolved" | "Ambiguous" | "Unconfirmed" | "NoSpec" | "Unknown", apiId?: string, specSources?: string[] (any of these URLs counts as the correct Current Spec Source), candidates?: string[] (expected API ids when Ambiguous), evidenceUrl: string, reviewed: boolean, notes?: string }`.
  `apiId` and `specSources` are required when `expected` is Resolved. Ship the file with 3 example entries (one Resolved, one Ambiguous, one Unknown), each with `"reviewed": false`.
- `src/benchmark/score.ts`: `score(entries, results)` is a pure function returning:
  - `falseResolutionRate` = Resolved answers whose API id or Spec Source is wrong ÷ all Resolved answers (0 when there are none);
  - `longtailCoverage` = correct Resolved answers on `longtail` entries ÷ `longtail` entries expected Resolved;
  - `outcomeAccuracy` = answers whose Outcome equals `expected` ÷ all entries;
  - per-group counts and the list of failures (name, expected, got, why).
  URLs compare after normalization: lowercase host, no trailing slash, no fragment, and `http` equal to `https`.
- `src/benchmark/run.ts`: `runBenchmark({lookup, entries, onlyReviewed, concurrency = 4})` calls the injected `lookup(name)` for each entry and then `score`. A lookup that throws counts as an `Unknown` answer and is listed as an error.
- `scripts/bench.ts`, run as `pnpm bench [--only-reviewed] [--json]`: prints a table (or JSON), and exits 1 when `falseResolutionRate >= 0.02`. Until #8 exists it runs against a stub lookup that answers `Unknown`; leave a clearly marked single place where #8 plugs in the real Lookup.

## Done when
- `src/benchmark/score.test.ts` covers: a wrong-API Resolved counts as a False Resolution; a Resolved answer with an Alternate Source listed in `specSources` counts as correct; zero Resolved answers give rate 0; URL normalization cases; `onlyReviewed` filtering.
- `src/benchmark/entry.test.ts` validates `benchmark/entries.json` against the schema.
- `pnpm check` green, and `pnpm bench` runs and prints the table with the stub.

---

## 4. swaggerbot: Judge interface, Jev adapter and fake judge

## Problem
ADR 0001 says code retrieves Candidates and Jev makes the narrow judgments behind an interface the vendor can be swapped behind, but no such interface exists and nothing calls TypeSafe.

## Change
- `src/judge/judge.ts`, the interface (all async, all returning probabilities in 0..1):
  - `whichApi(name, candidates: {id, name, vendor, description?}[])` → `{probabilities: Record<id | "none", number>, confidence}`: which API the name means, with `"none"` meaning none of them;
  - `isSpecLink(api, link: {url, text, context?})` → `{probability, confidence}`: whether this link or document is the Spec for the API;
  - `specDescribesApi(api, extract: SpecExtract)` → `{probability, confidence}`: whether the Spec describes the API. `SpecExtract` = `{title, description (first 500 chars), serverHosts, tags (first 20), samplePaths (first 20), pathCount}`; never send a whole Spec (ADR 0001).
- `src/judge/jev.ts`: an implementation using `@typesafe-ai/sdk` (`TypeSafeClient`, key from `TYPESAFE_API_KEY`). `whichApi` is a `choice`; the other two are `noul` questions. When a caller has several links, batch them into one `systemOne` call (fan-out). Question wording lives in one exported constant per judgment. Errors and timeouts (10 s) throw a `JudgeError` carrying the cause; retry once on 429/5xx.
- `src/judge/fake.ts`: `FakeJudge`, constructed with scripted answers per input (keyed by name/url), and a default answer otherwise. Every later test uses it; no test calls TypeSafe.
- `src/judge/index.ts`: `createJudge()` returns the Jev judge when `TYPESAFE_API_KEY` is set and otherwise throws a clear error naming the variable.

New dependency allowed: `@typesafe-ai/sdk`.

## Done when
- `src/judge/jev.test.ts` stubs the SDK client (inject it through the constructor): each judgment maps the SDK response to the interface shape, several links go out as one call, a 429 is retried once, and a timeout throws `JudgeError`.
- `src/judge/fake.test.ts` covers scripted and default answers.
- `pnpm check` green. Include the live smoke command `pnpm tsx scripts/judge-smoke.ts` (asks `whichApi("stripe", …)` with two candidates and prints the result); it is not part of `check`.

---

## 5. swaggerbot: polite fetcher, known-path probe and Spec sniffing

## Problem
Discovery must fetch pages and Specs from Vendors' domains, but there is no HTTP layer that honours the PRD's crawling etiquette (robots.txt, an honest User-Agent, per-host rate limits), no known-path check, and no way to tell whether a fetched document is a Spec.

## Change
- `src/fetch/fetcher.ts`: `createFetcher(opts)` → `fetchUrl(url)` → `{url, finalUrl, status, contentType, bytes}`, or a typed `FetchError` (`robots-disallowed | timeout | too-large | http-error | network`).
  - User-Agent `swagger.bot/0.1 (+https://github.com/evolv3ai/swaggerbot)`.
  - robots.txt is fetched once per origin, cached for an hour, and parsed with `robots-parser` (allowed dependency). A missing robots.txt (404) allows everything; a 5xx disallows for that hour.
  - At least 1000 ms between requests to one host (configurable; tests use 0), 10 s timeout, a 10 MB body cap, and at most 5 redirects, with robots.txt re-checked on each redirected origin.
  - Only `http:` and `https:` URLs. Refuse private, loopback and link-local addresses unless `allowPrivate: true` (tests only).
- `src/fetch/sniff.ts`: `sniffSpec(bytes, contentType)` parses JSON or YAML (the `yaml` package) and returns `null` unless the top level has `openapi` starting `3.` or `swagger: "2.0"`, plus `paths` or `info`. Otherwise it returns `{specVersion, format, extract: SpecExtract}`, with the same `SpecExtract` shape as the Judge (define it in `src/domain/spec-extract.ts`).
- `src/fetch/known-paths.ts`: `probeKnownPaths(domain, fetcher)` tries the hosts `domain`, `api.`, `developer.`, `developers.` and `docs.` (hosts in parallel, paths sequential per host) with the paths `/openapi.json`, `/openapi.yaml`, `/swagger.json`, `/swagger.yaml`, `/v3/api-docs`, `/api-docs`, `/.well-known/openapi.json`, `/apis.json`. It returns every hit that sniffs as a Spec (plus the `apis.json` entries' spec URLs, fetched and sniffed), as `{url, sniff, bytes}`. The overall budget is 12 s; unfinished hosts are dropped, not awaited.

## Done when
- Tests start a local `node:http` fixture server on port 0 with `allowPrivate: true`. Covered: robots.txt disallow is honoured; the rate limit spaces two requests to one host; the body cap and timeout produce the right `FetchError`; a redirect onto a disallowed origin is refused; the probe finds `/v3/api-docs` and an `apis.json`-listed Spec, and ignores an HTML 200.
- `sniff.test.ts`: OpenAPI 3.1 YAML, Swagger 2.0 JSON, an HTML page, a JSON non-spec and a truncated YAML file.
- A test proves a private address is refused by default.
- `pnpm check` green.

---

## 6. swaggerbot: APIs.guru Source

## Problem
Step 2 of the PRD's Source chain is APIs.guru, which covers popular APIs cheaply, but nothing reads it.

## Change
- `src/sources/apis-guru.ts`: `createApisGuru({fetchJson, cachePath = "data/apis-guru-list.json", ttlHours = 24})`.
  - Loads `https://api.apis.guru/v2/list.json`, cached on disk with a 24 h TTL. On a fetch failure a stale cache is still used; with no cache it throws.
  - `findCandidates(name)` → up to 10 API Candidates `{apiId, name, vendor: {id, name, domain}, description, preferredVersion, mirrorUrl (the APIs.guru swaggerUrl), originUrls (info["x-origin"][].url), updated}`, ranked by a simple score: exact provider or title match > prefix > token overlap on `normalizeName` from #2, with ties broken by provider/key order. No Jev here; judging is #8's job.
  - Map APIs.guru keys (`stripe.com`, `googleapis.com:drive`) to our ids: the provider is the Vendor id, and the service name or title slug is the API slug.
- The APIs.guru copy's provenance is `Mirror`; an `x-origin` URL on the Vendor's domain is reported as a possibly-Official Source for #8 to fetch and confirm. Don't assign Official here.
- Uses the global `fetch`, not #5's fetcher: this is a registry API, not crawling, and there's no robots.txt concern.

## Done when
- `src/sources/apis-guru.test.ts` uses a trimmed fixture `src/sources/__fixtures__/apis-guru-list.json` (about 15 real entries, including Stripe, two googleapis services, and a vendor with several APIs). It covers: exact match ranks first; "google drive" finds `googleapis.com:drive`; the cache is used within the TTL and a stale cache on network failure; no cache plus network failure throws; `originUrls` are extracted.
- `pnpm check` green.

---

## 7. swaggerbot: WebSearch interface and Brave adapter

## Problem
Step 3 of the Source chain finds the Vendor's Developer Portal with a web search API. There is no search abstraction, and the PRD's open question on provider is settled as Brave first, then Tavily, with the Benchmark picking the default.

## Change
- `src/sources/web-search/web-search.ts`: the interface `search(query, {count}) → {url, title, snippet}[]`.
- `src/sources/web-search/brave.ts`: calls Brave's Web Search API (`GET https://api.search.brave.com/res/v1/web/search`, header `X-Subscription-Token` from `BRAVE_API_KEY`), mapping `web.results`. 8 s timeout, one retry on 429/5xx, then a typed `SearchError`.
- `src/sources/web-search/index.ts`: `createWebSearch()` picks by `SEARCH_PROVIDER` (`brave` default). When the chosen provider's key is missing, it returns `null` and logs one warning; the pipeline then skips step 3 and doesn't fail.
- `src/sources/portal.ts`: `findPortalCandidates(name, search)` queries `"<name> API reference developer documentation"` with `count: 8` and returns up to 5 `{url, domain, title, snippet}`, deduplicated by registrable domain. Drop known non-Vendor hosts (`github.com`, `stackoverflow.com`, `medium.com`, `apis.guru`, `rapidapi.com`, `postman.com`, `wikipedia.org`), a list kept as an exported constant.
- A fake `WebSearch` in `src/sources/web-search/fake.ts` for tests.
- Registrable domains come from `tldts` (allowed dependency), exported as `registrableDomain(url)` from `src/sources/domain.ts` so #8 can reuse it.

## Done when
- `brave.test.ts` stubs `fetch`: request shape and header, result mapping, retry-then-error, timeout.
- `portal.test.ts` uses the fake: domain dedupe, excluded hosts, the 5 cap.
- `index.test.ts`: provider selection, and `null` plus a warning with no key.
- `pnpm check` green. Live smoke: `pnpm tsx scripts/search-smoke.ts "twilio"` (not in `check`).

---

## 7b. swaggerbot: Tavily adapter for WebSearch

## Problem
Portal finding is meant to be compared across Brave and Tavily on the Benchmark, but only Brave exists (`src/sources/web-search/brave.ts`).

## Change
- `src/sources/web-search/tavily.ts` implements the same `WebSearch` interface using Tavily's search API (`POST https://api.tavily.com/search`, key from `TAVILY_API_KEY`, authenticated as Tavily's current docs specify), with `search_depth: "basic"`, `max_results` = count and no raw content. It maps `results[]` to `{url, title, snippet: content}`, with the same timeout, retry and `SearchError` behaviour as Brave.
- `createWebSearch()` accepts `SEARCH_PROVIDER=tavily`. Brave stays the default.
- Add `--search brave|tavily` to `pnpm bench` (#3's script) so both can be compared; it just sets the provider for that run.

## Done when
- `tavily.test.ts` stubs `fetch`: request body and auth, mapping, retry-then-error, timeout.
- `index.test.ts` covers `tavily` selection.
- `pnpm check` green. `scripts/search-smoke.ts` gains `--provider tavily`.

---

## 8. swaggerbot: Lookup pipeline and POST /api/lookup

## Problem
The parts exist separately (Index #2, Benchmark runner #3, Judge #4, fetcher and probe #5, APIs.guru #6, WebSearch and portal finding #7), but nothing turns a name into an Outcome, and there is no HTTP endpoint.

## Change
`src/lookup/lookup.ts`: `createLookup({db, judge, apisGuru, webSearch | null, fetcher, thresholds, now})` → `lookup({name, apiVersion?, allowCommunity?, fresh?})` → Outcome (the #2 types). The Source chain runs in order and stops when the Outcome is settled:
1. **Index:** `findApiByName`. If the API has a Spec, answer Resolved from the Index (with `verifiedAt` = the Source's `lastVerifiedAt`). `fresh` is accepted and ignored in Slice 1 (Verification is Slice 3); document that in the code.
2. **APIs.guru:** Candidates, then `whichApi`.
3. **Portal:** if step 2 settled nothing, portal Candidates (when `webSearch` is set). Each portal domain becomes a Candidate API, then `whichApi` again over all Candidates.
4. **Known paths** on the chosen API's Vendor domain.

Deciding the Outcome, with thresholds from `src/lookup/thresholds.ts` (exported defaults, overridable, tuned later on the Benchmark):
- `whichApi`: `none` ≥ 0.6 → Unknown. Otherwise the top probability ≥ `apiPick` (0.75) with a margin ≥ `apiMargin` (0.3) over the second → identified; otherwise Ambiguous, with the Candidates whose probability ≥ 0.1.
- For the identified API, gather Spec Candidates: APIs.guru `originUrls` fetched and sniffed, known-path hits, and the APIs.guru mirror as a last resort. For each, run `specDescribesApi` on its extract. The best Official Candidate with probability ≥ `describes` (0.8) → Resolved. The best one between `doubt` (0.4) and 0.8 → Unconfirmed, with reasons (the probability and what was checked). None above 0.4 → No Spec (`communityAvailable: false` in Slice 1).
- Provenance in Slice 1: `Official` when the Source's registrable domain equals the Vendor's domain (or the Vendor's GitHub org, when APIs.guru names one); the APIs.guru copy is `Mirror`. A Resolved answer needs an Official Source; with only a Mirror above threshold, answer Unconfirmed with the reason "only a third-party copy found". Endorsed and Community are Slice 2.
- On Resolved or Unconfirmed, store the Vendor, API, Spec (Published Form bytes) and Sources in the Index, and `rememberName`.
- A Judge or search error doesn't crash the Lookup: that step is skipped, and if nothing settles, the Outcome is Unknown with the error listed in a `diagnostics` field (add optional `diagnostics: string[]` to every Outcome).

`POST /api/lookup`: the body `{name, apiVersion?, allowCommunity?, fresh?}` is validated with zod (400 with the issues on failure) → 200 with the Outcome JSON. The route wires the real dependencies from env via one `createAppLookup()` in `src/lookup/app.ts`, which `scripts/bench.ts` also uses (replacing #3's stub).

## Done when
- `src/lookup/lookup.test.ts` uses FakeJudge, a fake WebSearch, an APIs.guru fixture and #5's local fixture server. It covers each Outcome: Resolved via APIs.guru origin; Resolved via portal + known path; Ambiguous on a close margin; Unknown on `none`; Unconfirmed on mid probability; Unconfirmed on Mirror-only; No Spec. It also covers: a second Lookup of the same name is answered from the Index without calling the Judge; and a thrown Judge error yields Unknown with diagnostics.
- A route test: invalid body → 400, valid → 200 with an Outcome (dependencies faked).
- `pnpm check` green. `pnpm bench` now runs the real Lookup; running it live is the reviewer's job, not the agent's.

---

## 9. swaggerbot: Benchmark seed, about 40 labelled entries

## Problem
`benchmark/entries.json` (format from #3, `src/benchmark/entry.ts`) has only 3 example entries. The release gate needs a labelled Benchmark, and every label must be true: a wrong label silently skews the False Resolution rate.

## Change
Replace the examples with about 40 entries, all `"reviewed": false`:
- 12 `popular` (e.g. Stripe, GitHub REST, Twilio, Slack Web API, Jira Cloud Platform REST);
- 12 `longtail` (smaller Vendors that publish a Spec on their own domain and aren't well covered by APIs.guru);
- 10 `ambiguous` (names that plausibly mean several APIs, e.g. "Google", "Atlassian", "Azure", "Mercury"), with `candidates` listed;
- 6 `negative`: 3 real products with no public Spec (expected `NoSpec`, with `apiId`) and 3 names that match no API (expected `Unknown`).

Rules for every entry:
- `evidenceUrl` is a page you actually opened in this session that shows the label is right: the Vendor page linking the Spec, or for NoSpec the API docs page with no Spec offered.
- `specSources` URLs were fetched in this session and returned a Spec (OpenAPI 3 or Swagger 2 at the top level). Prefer the Vendor's own URL, and list the Vendor's GitHub raw URL as an alternate when both exist.
- Where you are unsure, leave the entry out rather than guess. Add a `notes` line for anything a reviewer should look at.
- Don't change `src/benchmark/`; if the schema can't express something, say so in the PR description instead.

## Done when
- `src/benchmark/entry.test.ts` passes on the new file, and a new test asserts the group counts and that every Resolved entry has `specSources`.
- The PR description lists every entry you were least sure of.
- `pnpm check` green.
