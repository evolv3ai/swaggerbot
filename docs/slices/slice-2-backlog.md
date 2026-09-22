# Slice 2 backlog: Provenance and versions

The issues for [Slice 2](../PRD.md#slice-2--provenance-and-versions), written so the weawr factory can build them: each body is filed as-is on Linear (team WTR, labels `ai` + `swaggerbot`). Capitalised terms are from [`CONTEXT.md`](../../CONTEXT.md). Conventions shared by every issue (layout, env vars, the gate) live in `.weawr/instructions.md`, which every agent reads.

**Acceptance:** False Resolution < 2% and long-tail coverage ≥ 60%.

## Where it stands going in

Live `pnpm bench` on 2026-09-22 after Slice 1's tuning round: False Resolution 0/9 once Stripe's and Supabase's second Official Source were accepted, long-tail coverage 3/12, Outcome accuracy 47.5%. So Slice 2 does not have to rescue precision; it has to raise long-tail coverage from 3/12 to at least 8/12 without losing precision.

Where the twelve long-tail Specs actually live, checked live:

| Entry | Spec | Found by |
|---|---|---|
| Novu, Replicate | — | already Resolved |
| Supabase | `supabase.com/openapi.json` | already Resolved (known path) |
| Loops | `app.loops.so/openapi.json` | #2, the `app.` host prefix |
| Mux | `www.mux.com/api-spec.json` | #6, portal crawl |
| Firecrawl | `docs.firecrawl.dev/api-reference/v2-openapi.json` | #6 |
| Render | `api-docs.render.com/openapi/render-public-api-1.json` | #6 |
| Neon | `neon.com/api_spec/release/v2.json` | #6, plus #10 for the `neon.tech` split |
| Infisical | `app.infisical.com/api/docs/json` | #6 |
| Fly.io | `docs.machines.dev/openapi.json` (another domain fly.io links to) | #6, as an **Endorsed** Source — by known-path probe on the off-host host, not by a link hop; see the note under #6 |
| Val Town | `api.val.town/openapi.json` | #6 + #4, the ADR 0003 exception |
| Codeberg | `codeberg.org/swagger.v1.json` | never: re-labelled NoSpec, see ADR 0003 |

The six popular failures (Box, Asana, PagerDuty, Cloudflare, GitHub REST, Slack) all have their Spec in a Vendor GitHub repo that APIs.guru doesn't point at, which is #3 and #7 — **plus #12**, added after a live probe of #3 showed that code search alone is not enough: `cloudflare/api-schemas/openapi.json` is 26 MB, past GitHub's code-search indexing limit, so `repo:cloudflare/api-schemas openapi in:path` returns nothing while repository search finds it at once. That same 26 MB is also over the fetcher's 10 MB body cap, so finding it is not enough to serve it — Wes decided to raise the cap (#13).

So the **portal crawl carries the gate** and code search carries precision on the popular set.

## Order

Filed 2026-09-22 as WTR-41..51, with Linear "blocked by" relations mirroring this table. An issue moves from Backlog to Agent Todo only when everything it depends on is merged.

| # | Linear | Issue | Depends on | Wave |
|---|---|---|---|---|
| 1 | WTR-41 | Benchmark: a throwaway Index per run | — | 1 |
| 2 | WTR-42 | Known-path probe: more hosts and paths, and keep what was found | — | 1 |
| 3 | WTR-43 | GitHub code search | — | 1 |
| 4 | WTR-44 | Fetch a Vendor-linked Spec once despite `robots.txt` | — | 2 |
| 5 | WTR-45 | Shallow Developer Portal crawl, with link selection by Jev | — | 2 |
| 6 | WTR-46 | Wire the crawl into the Source chain | 4, 5 | 3 |
| 7 | WTR-47 | Wire GitHub code search into the Source chain | 3, 6 | 4 |
| 8 | WTR-48 | Provenance: Endorsed and Community, and `allowCommunity` | 7 | 5 |
| 9 | WTR-49 | API Versions: Current, Alternate, Superseded, Preview | 8 | 6 |
| 10 | WTR-50 | Candidate identity: the Neon split and GitHub's 20 APIs.guru entries | 7 | 5 |
| 11 | WTR-51 | A Vendor's APIs from its Developer Portal | 6 | 5 |
| 12 | WTR-52 | GitHub repository search and tree probing, for Specs code search can't index | — | 2 |
| 13 | WTR-53 | Raise the fetched-Spec size cap from 10 MB | — | 2 |

#6, #7, #8, #10 and #11 all touch `findSpec`/`lookup` in `src/lookup/lookup.ts`, so they are queued one wave at a time and rebased in arrival order rather than run together.

After #9 merges, run `pnpm bench` live, tune `src/lookup/thresholds.ts` by hand on the reviewed entries, and record the result in `docs/slices/slice-2-result.md`.

---

## 1. swaggerbot: give the Benchmark a throwaway Index per run

## Problem
`scripts/bench.ts` builds its Lookup with `createAppLookup()`, which opens the Index at `DATABASE_PATH` (default `./data/swaggerbot.db`). That file persists between runs, and step 1 of the Lookup (`answerFromIndex` in `src/lookup/lookup.ts`) returns a stored Resolved answer for any name already settled, without running Discovery at all. Twelve names are stored in the working copy today, nine of them with a confirmed Spec.

A Benchmark run therefore measures Discovery only for the names the Index has never resolved, and measures Index replay for the rest. Coverage, Outcome accuracy and latency are all a blend of the two, and a run gets easier every time it is repeated. Slice 2 is judged on a coverage number, so this has to be fixed before any of it can be believed.

## Change
In `scripts/bench.ts`, before `createAppLookup()` is called:
- By default, create a fresh empty SQLite file in `os.tmpdir()` (`mkdtemp`, e.g. `swaggerbot-bench-XXXX/index.db`), set `process.env.DATABASE_PATH` to it, and delete the directory when the run ends — in a `finally`, so a crash cleans up too. Deleting the directory takes the `-wal` and `-shm` files with it.
- `--index <path>` uses that path instead and never deletes it, for comparing runs or inspecting what was stored.
- `--keep-index` keeps the temp directory and prints its path.
- `--index` and `--keep-index` together is an error (exit 2), like the existing `--search` validation.

The report header (the `table` function and the `--json` report) gains a line naming the Index used: `Index: fresh (temporary)`, `Index: kept at <path>` or `Index: <path>`. In `--json`, add `indexPath` and `indexFresh` to the report object; extend `BenchmarkReport` in `src/benchmark/score.ts` with those two optional fields so the type stays honest.

Nothing about scoring, the entries or the Lookup changes. `createAppLookup` is not touched: setting `DATABASE_PATH` before calling it is enough, because `openDb` reads the env var at call time.

`README.md`: in whatever section describes `pnpm bench`, say that a run uses a throwaway Index by default so that it measures Discovery, and name the two flags.

## Done when
- `src/benchmark/score.test.ts` (or a new `scripts`-level test): the report object carries `indexPath` and `indexFresh`.
- A test for the flag handling that does not run a Benchmark: `--index` and `--keep-index` together exits 2. Factor the `parseArgs` handling into an exported pure function in `scripts/bench.ts` (or a small `src/benchmark/cli.ts`) so it can be tested without executing a run.
- Running `pnpm bench --only-reviewed` twice in a row gives the same set of Outcomes for a name that was Resolved the first time — describe this as a manual check in the PR description; don't write a test that touches the network.
- `README.md` updated.
- `pnpm check` and `pnpm build` green.

---

## 2. swaggerbot: known-path probe — more hosts and paths, and keep what was found

## Problem
`probeKnownPaths` in `src/fetch/known-paths.ts` tries five host prefixes (`""`, `api.`, `developer.`, `developers.`, `docs.`) against eight paths, inside a 12 s budget. Two things go wrong on the live Benchmark.

**Hosts that Vendors actually use are missing.** Loops publishes its Spec at `https://app.loops.so/openapi.json` — a known path on a host the probe never tries — so Loops answers NoSpec although nothing clever is needed to find it. Infisical (`app.infisical.com`) and Render (`api-docs.render.com`) sit on the same kind of host.

**A host that runs out of budget loses the hits it already had.** `probeHost` returns its hits only when it finishes the whole path list; on timeout the comment says "Unfinished hosts stop fetching; their partial hits are dropped", and they are. With the fetcher's 1 s per-host spacing, eight paths plus the `robots.txt` fetch need about 9 s on a fast host, so the budget is routinely the thing that ends the loop. Live probes on 2026-09-22 of `loops.so`, `mux.com` and `codeberg.org` all hit the 12 s budget and returned nothing at all. Adding paths without fixing this would make the probe worse, not better.

## Change
In `src/fetch/known-paths.ts`:

- `KNOWN_HOST_PREFIXES` gains `app.`, `api-docs.` and `spec.`.
- `KNOWN_PATHS` gains `/api-json` (NestJS), `/v1-json`, `/swagger/v1/swagger.json` (ASP.NET), `/openapi.yml`, `/api/openapi.json`, `/docs/openapi.json` and `/spec/openapi3.json`. Order the whole list most-likely-first (`/openapi.json`, `/openapi.yaml`, `/swagger.json`, `/swagger.yaml`, then the rest, with `/apis.json` last), because a host may not get through it.
- Hits are kept as they are found. Give `probeHost` a `collect: (hit: KnownPathHit) => void` callback (or a shared array) that it calls the moment a path yields a Spec, and have `probeKnownPaths` build its result from what was collected rather than from the resolved return values. A host stopped by the budget then keeps everything it found before the stop; only its unfinished work is lost. Dedupe by `url` as today.
- `DEFAULT_BUDGET_MS` rises to 25 s, and the doc comment says it is a budget for the whole call across all hosts, not per host.

Nothing else changes: the `apis.json` following, the `isHostDead` short-circuit, the per-host sequencing and the `ProbeOptions` shape all stay as they are.

The longer budget costs Discovery latency on names where APIs.guru settles nothing, which is already over the PRD's 15 s p90 target. That target belongs to Slice 3; say so in the PR description rather than tuning for it here.

## Done when
- `src/fetch/known-paths.test.ts`, against the existing `__fixtures__` server:
  - a host whose first path yields a Spec and whose later paths never answer still returns that Spec when the budget expires (set `budgetMs` low and make a later path hang);
  - each new host prefix is tried;
  - a Spec at one of the new paths is found;
  - the existing cases (`apis.json` following, dead-host short-circuit, dedupe) still pass.
- `pnpm check` and `pnpm build` green.

---

## 3. swaggerbot: GitHub code search

## Problem
Step 5 of the PRD's Source chain — GitHub code search, the Vendor's organisation first and then everywhere else — does not exist. `src/sources/github.ts` only reads repo metadata (`repoInfo`). Six popular Benchmark entries fail because their Spec lives in a Vendor GitHub repo that APIs.guru does not point at: `box/box-openapi`, `Asana/openapi`, `PagerDuty/api-schema`, `cloudflare/api-schemas`, `github/rest-api-description` and `slackapi/slack-api-specs`.

## Change
Add to `src/sources/github.ts` (alongside `createGitHubRepos`, sharing its `FetchJson` type and headers):

```ts
export type SpecHit = { fullName: string; path: string; url: string };
export type GitHubCodeSearch = {
  /** Spec-looking files in an org, or across GitHub when `org` is null. */
  searchSpecs(org: string | null, name: string): Promise<SpecHit[] | null>;
};
export function createGitHubCodeSearch(opts): GitHubCodeSearch
```

- **A token is required.** GitHub refuses code search unauthenticated. Without `token`, `searchSpecs` returns `null` and warns once, the same shape `createGitHubRepos` uses for a rate limit. Take the token as an option, not from the environment; the caller passes `process.env.GITHUB_TOKEN`.
- **Query shape, verified live on 2026-09-22:** `org:<org> openapi in:path` works and returns the right repos. `filename:openapi.json` and `path:openapi.json` both return nothing — do not use them. The global query is `<name> openapi in:path`. URL-encode the query and request `per_page=20`.
- **Filter the results** before returning them: keep only paths ending `.json`, `.yaml` or `.yml`; drop any path with a segment of `node_modules`, `test`, `tests`, `fixture`, `fixtures`, `example`, `examples`, `vendor` or `dist`. Cap at 10 hits. A live search of `org:cloudflare openapi in:path` returns 71 results, most of them `.ts` and `.mdx` source files, so this filter is what makes the step usable.
- **Build `url`** as `https://raw.githubusercontent.com/{fullName}/HEAD/{path}` — the caller resolves the real default branch through the existing `repoInfo`, so don't guess a branch here.
- **Rate limit.** Authenticated code search allows 10 requests a minute. Keep at least 6 s between calls from one instance (a simple `nextSlot` timestamp, like the fetcher's `waitTurn`). On 403 or 429, warn once and return `null` for that call and every later one in the same minute.
- Any other non-200, a network error or an unparsable body returns `null` after one warning. Parse the response with zod (`{ items: [{ path, repository: { full_name } }] }`).

`.env.example` gains `GITHUB_TOKEN`, with a comment that repo metadata works without it but code search does not, and that a fine-grained token with public-repository read access is enough.

## Done when
- `src/sources/github.test.ts`, with a stubbed `fetchJson`:
  - the org query and the global query are built as described, URL-encoded;
  - the extension and path-segment filters drop the right hits, and the cap holds at 10;
  - `url` is built on `HEAD` from `full_name` and `path`;
  - no token → `null`, one warning, and no request made;
  - 403 → `null` and one warning;
  - an unparsable body → `null`.
  - Calls are spaced: with a fake clock or an injected `sleep`, two consecutive searches are at least 6 s apart. Keep the test fast — inject the delay, don't wait on it.
- `.env.example` updated.
- `pnpm check` and `pnpm build` green.

---

## 4. swaggerbot: fetch a Vendor-linked Spec once despite `robots.txt`

## Problem
[ADR 0003](../adr/0003-robots-txt-exception-for-vendor-linked-specs.md) decides that a single Spec document linked from a Vendor page we were allowed to fetch is retrieved once even when that document's own host disallows it. `src/fetch/fetcher.ts` has no way to do that: `fetchUrl` always consults `robots.txt` and throws `robots-disallowed`.

The case this unblocks: `api.val.town/robots.txt` is `Disallow: /`, while `docs.val.town` allows crawling and its `/openapi` page links `https://api.val.town/openapi.json`. Today Val Town answers NoSpec for an API whose Vendor publishes and advertises a Spec.

## Change
In `src/fetch/fetcher.ts`:
- The per-request options of `fetchUrl` gain `ignoreRobots?: boolean`, default `false`. When true, the `robots.txt` lookup is skipped for that request, including across its redirects.
- Everything else is unchanged and still applies: the honest `USER_AGENT`, the per-host spacing, the body size cap, the redirect cap, the timeout and the private-address guard. This flag removes exactly one check and nothing else.
- The successful result gains `robotsDisallowed: boolean` — true when the flag was set *and* the host's `robots.txt` would have refused this URL, false otherwise. Compute it from the same cached verdict the normal path uses, so it costs no extra request. Callers use it to record a diagnostic.

Nothing in `src/` sets the flag yet; #6 does. Leaving it unused for one issue is deliberate.

`README.md`: in the section describing crawling etiquette (or add two lines if there is none), state the exception and link ADR 0003.

## Done when
- `src/fetch/fetcher.test.ts`, against the existing fixture server with a `robots.txt` that disallows the path:
  - the default still throws `FetchError` of kind `robots-disallowed`;
  - with `ignoreRobots: true` the body is returned and `robotsDisallowed` is `true`;
  - with `ignoreRobots: true` on an *allowed* URL, `robotsDisallowed` is `false`;
  - a redirect from an allowed host to a disallowed one succeeds under the flag;
  - the per-host spacing and the size cap still apply under the flag.
- `README.md` updated.
- `pnpm check` and `pnpm build` green.

---

## 5. swaggerbot: shallow Developer Portal crawl, with link selection by Jev

## Problem
Six long-tail Benchmark entries publish their Spec on the Vendor's Developer Portal at a path no known-path probe will ever guess:

- `www.mux.com/api-spec.json`
- `docs.firecrawl.dev/api-reference/v2-openapi.json`
- `api-docs.render.com/openapi/render-public-api-1.json`
- `neon.com/api_spec/release/v2.json`
- `app.infisical.com/api/docs/json`
- `docs.machines.dev/openapi.json` — Fly.io's Spec, on a different domain that `fly.io/docs/machines/api/` links to

The PRD's Slice 2 asks for a shallow crawl of the Developer Portal with link selection by Jev. `isSpecLink` and `areSpecLinks` already exist on the `Judge` interface (`src/judge/judge.ts`), are implemented in `JevJudge` and `FakeJudge`, and nothing calls them.

## Change
Add `src/sources/crawl.ts`. It knows nothing about the Lookup: it takes what it needs and returns what it found.

```ts
export type CrawlHit = {
  url: string;
  bytes: Uint8Array;
  sniff: SniffResult;
  /** The page whose link led here. */
  linkedFrom: string;
  /** The link left the start URL's registrable domain. */
  offHost: boolean;
  /** The host's robots.txt disallowed this URL (ADR 0003). */
  robotsDisallowed: boolean;
};

export type CrawlOptions = {
  startUrl: string;
  api: ApiRef;
  fetcher: Fetcher;
  judge: Judge;
  /** Default 0.6. */
  threshold?: number;
  /** Default 8. */
  maxPages?: number;
  /** Default 20 s, for the whole crawl. */
  budgetMs?: number;
};

export async function crawlForSpecs(opts: CrawlOptions): Promise<CrawlHit[]>
```

How it works:

- Start at `startUrl`, depth 2, at most `maxPages` HTML pages, inside `budgetMs`. Only `text/html` responses are parsed for links; anything else is ignored.
- From each page, extract every `<a href>` as a `SpecLink`: `url` resolved against the page, `text` the anchor text (trimmed, collapsed whitespace, capped at 200 chars), `context` the nearest preceding heading or the enclosing paragraph's text, capped at 300 chars. Skip `mailto:`, `javascript:` and in-page fragments; dedupe by resolved URL. Cap at 60 links per page, in document order.
- Split them: a link is a **Spec candidate** when its path ends `.json`, `.yaml` or `.yml`, or contains `openapi`, `swagger`, `api-spec`, `api_spec` or `api-docs`. Everything else on the same registrable domain is a **page candidate**.
- Ask the Judge once per page: `areSpecLinks(api, [...specCandidates, ...pageCandidates])`. One call, answers in order, so the same judgment ranks both sets.
- Fetch Spec candidates scoring at or above `threshold`, highest first, and `sniffSpec` the bytes. A hit is kept; a non-Spec is not, and does not count against `maxPages`.
- Follow page candidates scoring at or above `threshold`, highest first, until `maxPages` or the budget.
- **Off-host links.** A Spec candidate on another registrable domain is followed **one hop** and flagged `offHost: true`, and #8 turns that flag into Endorsed Provenance. An off-host *page* candidate is never crawled. This is **not** how Fly.io is reached: verified live on 2026-09-22, `fly.io/docs/machines/api/` links only `docs.machines.dev/`, a Scalar SPA whose Spec is in a JS bundle, so no link hop reaches `docs.machines.dev/openapi.json`. The known-path probe does (200, 156,029 bytes), so Fly.io needs #6 to probe known paths on an off-host portal host — see WTR-46.
- **Disallowed Spec candidates.** When fetching a Spec candidate throws `robots-disallowed`, retry it once with `ignoreRobots: true` (#4) and set `robotsDisallowed` from the result. This applies only to a Spec document reached by a link from an allowed page, which is exactly ADR 0003's exception. A *page* that is disallowed is never fetched.
- A fetch error, a Judge error or a 404 skips that link and the crawl continues; a Judge error on a page means that page contributes nothing. Nothing here throws: the worst case is an empty array.
- The fetcher's per-host spacing and the honest User-Agent do the rate limiting; don't add another.

## Done when
- `src/sources/crawl.test.ts`, against a fixture server (`src/fetch/__fixtures__/server.ts`) and `FakeJudge`:
  - a Spec linked from the start page is found, with `linkedFrom` set;
  - a Spec two hops away is found, and one three hops away is not;
  - an off-host Spec link is followed once and flagged `offHost`, while an off-host page link is not crawled;
  - a link the Judge scores below `threshold` is not fetched;
  - `maxPages` stops the crawl, and so does a low `budgetMs`;
  - a page that 404s, and a Judge error on one page, leave the rest of the crawl working;
  - a Spec candidate whose host disallows it is fetched on the retry and flagged `robotsDisallowed`;
  - a non-HTML start URL that is itself a Spec is returned as a hit.
- `pnpm check` and `pnpm build` green.

---

## 6. swaggerbot: wire the crawl into the Source chain

## Problem
`findSpec` in `src/lookup/lookup.ts` tries APIs.guru origin URLs, then known paths on the Vendor's domain, then the APIs.guru mirror, and then gives up. Step 4 of the PRD's Source chain ends with "a shallow crawl of the Developer Portal", and `crawlForSpecs` (#5) is not called from anywhere.

## Change
- `LookupDeps` gains `crawl?: (opts: { startUrl: string; api: ApiRef }) => Promise<CrawlHit[]>`, defaulting to `crawlForSpecs` bound to this Lookup's `fetcher` and `judge`. Tests inject a fake.
- `ApiChoice` gains `portalUrl?: string`. `fromPortal` sets it to the Candidate's page URL; APIs.guru-derived choices leave it unset.
- In `findSpec`, after the known-path probe and **before** the APIs.guru mirror, when `settled()` is still false: crawl from `choice.portalUrl ?? \`https://${choice.vendor.domain}\``. `consider` each hit with `provenanceOf(hit.url, choice.vendor)`; an `offHost` hit is Mirror for now (#8 makes it Endorsed). Stop as soon as `settled()`.
- Record in `checked`: `crawl from <startUrl> (<n> found)`. For a hit with `robotsDisallowed`, push a diagnostic naming the URL and saying the host's `robots.txt` disallowed it and ADR 0003 allowed the single fetch.
- A crawl that throws is caught, diagnosed (`crawl: <message>`) and treated as no hits, like the known-path probe above it.
- Carry `offHost` and `robotsDisallowed` on `SpecCandidate` so #8 can read them; nothing uses them yet beyond the diagnostic.

Order matters and is set by the PRD: known paths, then the crawl, then (in #7) GitHub code search.

## Done when
- `src/lookup/lookup.test.ts`, with a fake crawl and the fixture server:
  - a Spec found only by the crawl gives Resolved, with the crawl's URL as the Source;
  - the crawl is not called when the known-path probe already settled the answer;
  - the crawl starts from `portalUrl` for a portal-derived Candidate and from the Vendor domain otherwise;
  - a `robotsDisallowed` hit still resolves and adds the diagnostic;
  - a crawl that throws leaves the previous answer and adds a diagnostic.
- `src/lookup/app.ts` builds the real crawl.
- `pnpm check` and `pnpm build` green.

---

## 7. swaggerbot: wire GitHub code search into the Source chain

## Problem
`createGitHubCodeSearch` (#3) exists and nothing calls it. Step 5 of the PRD's Source chain is still missing, so six popular Benchmark entries — Box, Asana, PagerDuty, Cloudflare, GitHub REST and Slack — never find the Vendor repo that holds their Spec.

## Change
- `LookupDeps` gains `githubSearch?: GitHubCodeSearch`. `src/lookup/app.ts` builds it from `process.env.GITHUB_TOKEN`; absent, the dependency is left undefined.
- In `findSpec`, after the crawl and before the APIs.guru mirror, when `settled()` is still false and `githubSearch` is set:
  1. Search the Vendor's organisation, using the Vendor id's first label as the org (`box.com` → `box`). GitHub org names are case-insensitive, so no casing work is needed.
  2. If that returns nothing, search globally with the API's name.
  3. Judge the hits before fetching them: build a `SpecLink` per hit (`url`, `text` = the path, `context` = the repo's full name) and call `judge.areSpecLinks(ref, links)` once. Fetch only those at or above a new threshold `specLink`, default 0.6, added to `Thresholds` and `DEFAULT_THRESHOLDS` — it ranks links rather than Spec contents, so it is not `describes`.
  4. Fetch each surviving hit through the existing `fetchOrigin`, so an archived repo is skipped and `HEAD` is replaced by the repo's real default branch by `repoInfo`. Stop as soon as `settled()`.
- `searchSpecs` returning `null` (no token, rate limit, error) adds one diagnostic — `GitHub code search: skipped (no GITHUB_TOKEN)` or the failure — and changes nothing else. This is the same shape as the missing-web-search path in step 3.
- Record in `checked`: `GitHub code search in org <org> (<n> hits)` and, when it ran, the global search.
- Provenance stays as `provenanceOf` computes it: Official when the repo's org matches the Vendor, Mirror otherwise. Slack's Spec is in `slackapi/slack-api-specs`, which does **not** match `slack.com`'s label, so Slack will answer Unconfirmed on a Mirror until #8 introduces Endorsed. That is the correct answer for this issue; don't widen the org match to fix it here.

## Done when
- `src/lookup/lookup.test.ts`, with a fake `GitHubCodeSearch`:
  - an org hit resolves, and the org is derived from the Vendor id;
  - the global search runs only when the org search returned nothing;
  - hits below `specLink` are never fetched;
  - an archived repo among the hits is skipped (the existing fake `GitHubRepos`);
  - `null` from the search adds the diagnostic and leaves the previous answer;
  - the search does not run when the crawl already settled the answer.
- `src/lookup/thresholds.ts` documents `specLink`.
- `pnpm check` and `pnpm build` green.

---

## 8. swaggerbot: Provenance — Endorsed and Community, and `allowCommunity`

## Problem
`provenanceOf` in `src/lookup/lookup.ts` produces only `Official` or `Mirror`. `CONTEXT.md` defines four tiers and the PRD makes all four, plus the `allowCommunity` opt-in, Slice 2 scope. `LookupRequest.allowCommunity` is accepted and ignored, and `NoSpec.communityAvailable` is hard-coded `false`.

Two Benchmark entries turn on this. Fly.io's Spec is on `docs.machines.dev`, a domain `fly.io` links to — **Endorsed**, and it must be good enough to answer Resolved. Slack's is in `slackapi/slack-api-specs`, linked from Slack's own developer documentation — also Endorsed rather than the Mirror it is called today.

## Change
- **`provenanceOf` gains a third input**: `linkedFromVendor: boolean`. A Source that is neither on the Vendor's domain nor in the Vendor's GitHub org, but was reached by a link from a page on the Vendor's domain, is **Endorsed**. Keep the existing Official rules first.
- **Community**: a Source that is none of the above and whose bytes we have not already seen at an Official or Endorsed Source. A Source carrying the same `specId` as an Official or Endorsed candidate stays **Mirror** (it is a copy); different bytes from an unrelated third party are **Community**. Decide this in `findSpec`, where every candidate's `specId` is known, not inside `provenanceOf`.
- **Resolved accepts Official or Endorsed.** Change `confirmed()` and the Unconfirmed fallback in `findSpec` from `provenance === "Official"` to "Official or Endorsed", and `resolved()` to report the Spec's best Provenance rather than the literal `"Official"`. `answerFromIndex` likewise accepts a stored Endorsed Source.
- **`allowCommunity` reaches `findSpec`.** Thread it from `LookupRequest` (it is destructured away in `lookup()` today). When false — the default — Community candidates are never considered for the answer, but they are counted: if the only candidates at or above `t.doubt` were Community, answer `NoSpec` with `communityAvailable: true`. When true, a Community Spec may answer Resolved or Unconfirmed, and `Resolved.provenance` says `Community`.
- `src/routes/api/lookup.ts` passes `allowCommunity` through from the request body; it is already in the schema.
- Store the tier as computed: `repo.addSource` already takes a Provenance.

## Done when
- `src/lookup/lookup.test.ts`:
  - an off-host Spec linked from the Vendor's page is Endorsed and answers Resolved;
  - the same Spec's bytes found at an unrelated third party stay Mirror;
  - a Community-only Spec gives `NoSpec` with `communityAvailable: true` by default, and Resolved with `allowCommunity: true`;
  - an Official Source still wins over an Endorsed one when both describe the API.
- `src/domain/provenance.test.ts` covers `bestProvenance` over the four tiers (it may already).
- A test that `POST /api/lookup` passes `allowCommunity` through.
- `pnpm check` and `pnpm build` green.

---

## 9. swaggerbot: API Versions — Current, Alternate, Superseded and Preview

## Problem
`Spec.apiVersion` is stored as `null` for every Spec (`store` in `src/lookup/lookup.ts` passes `apiVersion: null`), `Resolved.alternateSpecs` is always `[]`, and `LookupRequest.apiVersion` is accepted and ignored. `CONTEXT.md` defines API Version, Preview Version, Current Spec, Alternate Spec and Superseded Spec, and the PRD makes them Slice 2 scope.

This is not hypothetical. Box publishes `openapi/openapi-v2025.0.json` and `openapi/openapi-v2026.0.json` side by side in one repo; Stripe's repo serves `latest/openapi.spec3.json` and a legacy `openapi/spec3.json`; GitHub's APIs.guru entries carry a `2022-11-28` dated variant.

## Change
- **Extract the API Version.** In `src/domain/spec-extract.ts` (or beside it), derive it from `info.version` when present. When absent or meaningless (`1.0.0` on a Spec whose Source path says otherwise), fall back to a version-looking segment of the Source URL: `v2`, `v2026.0`, `2024-06-20`, `release/v2`. Return `null` when neither says anything.
- **Preview** when the API Version or the Source path contains `alpha`, `beta`, `preview`, `rc` or `experimental` as a whole word, or `info["x-preview"]` is true. Store it.
- **Ordering.** Compare API Versions as: date-like (`YYYY-MM-DD`) newest first, then dotted-numeric by segment, then a plain string compare. Put the rule in one exported function with its own tests; every other decision here uses it.
- **Current, Alternate, Superseded.** When a Lookup has several Specs for one API: the **Current Spec** is the highest non-Preview API Version; the other non-Preview ones found in the same Lookup are **Alternates**; a Spec in the Index whose every Source stopped serving it is **Superseded**. The Vendor's own recommendation is not machine-readable — human curation of the Index is a PRD "Later" item — so say in a code comment that highest-non-Preview is a stand-in for it.
- **Schema.** Fill `specs.api_version`; add `specs.is_preview` (integer, default 0) and `specs.superseded_at` (text, nullable); write the migration in `drizzle/`. `Spec` in `src/domain/catalog.ts` gains `isPreview: boolean` and `supersededAt: string | null`.
- **Returning them.** `Resolved.currentSpec` is the Current Spec; `alternateSpecs` lists the Alternates. A Preview Version and a Superseded Spec are never returned by default. `LookupRequest.apiVersion`, when given, selects that API Version exactly — including a Preview or Superseded one — and answers `NoSpec` when the API has no such Version.
- `src/routes/api/lookup.ts` passes `apiVersion` through.

## Done when
- Tests for version extraction: `info.version`, the path fallback, each Preview marker, and `null` when nothing says.
- Tests for the ordering function, including dates against dotted numbers.
- `src/lookup/lookup.test.ts`: three Specs for one API give the right Current and Alternates; a Preview is excluded from both; `apiVersion` selects an Alternate, and an unknown one gives `NoSpec`.
- A migration test, or an existing schema test extended, covering the new columns.
- `pnpm check` and `pnpm build` green.

---

## 10. swaggerbot: Candidate identity — the Neon split and GitHub's 20 APIs.guru entries

## Problem
Two Benchmark entries answer Ambiguous where one API is meant, both because Candidates that are the same thing are not merged.

**Neon.** A live Lookup on 2026-09-22 returned `neon.tech/api` at 0.48 and `neon.com/api` at 0.43. `followPortals` in `src/lookup/lookup.ts` is meant to collapse these: it fetches each Candidate's **origin** and re-homes the Candidate on the final registrable domain. `https://neon.tech` does redirect to `https://neon.com/` — the project's own fetcher follows it correctly when asked directly — so the merge fails only when that one origin fetch doesn't come back (`neon.tech/robots.txt` answers with an HTML "Redirecting…" body, and the origin probe competes with the other portal fetches). On failure the code keeps the Candidate's search domain, and the split survives.

**GitHub REST API.** APIs.guru carries **20** `github.com*` entries — `github.com`, `github.com:api.github.com`, `:ghec`, `:ghes-2.18` through `:ghes-3.8`, `:github.ae` and a `2022-11-28` dated variant — every one of them titled "GitHub v3 REST API". They are deployment variants and versions of one API, not twenty APIs, so `whichApi` is asked to choose between identical things and can only answer Ambiguous.

## Change
In `src/lookup/lookup.ts`:

- **Follow the Candidate's own URL, not its origin.** In `followPortals`, fetch `p.url` (the page the search actually found) and take the final registrable domain from that. Keep the per-origin memoisation keyed by registrable domain so several Candidates on one site cost one fetch. Only if that fetch fails, fall back to fetching the origin; only if that fails too, keep the search domain and push a diagnostic naming the Candidate whose domain could not be settled. A fetch is needed for these pages anyway, so this costs nothing extra.
- **Merge APIs.guru Candidates that are one API.** In the step that builds `guru` choices, group Candidates by Vendor id **and** identical `info.title`, and keep one choice per group: its name and description from the first, and `originUrls` the union of the group's, in order, capped at 8. Prefer as the group's representative the Candidate whose APIs.guru key has no `:` suffix, else the first. Two Candidates of one Vendor with *different* titles are left alone — this rule merges duplicates, never distinct APIs.

## Done when
- `src/lookup/lookup.test.ts`, with the fake search and the fixture server:
  - two portal Candidates whose pages both end on one domain become a single Candidate;
  - when the page fetch fails but the origin fetch succeeds, the Candidate is still re-homed;
  - when both fail, the Candidate keeps its search domain and a diagnostic says so;
  - twenty APIs.guru Candidates for one Vendor with one title collapse to a single choice carrying their origin URLs;
  - two Candidates of one Vendor with different titles stay separate.
- `pnpm check` and `pnpm build` green.

---

## 11. swaggerbot: a Vendor's APIs from its Developer Portal

## Problem
`vendorCandidates` in `src/lookup/lookup.ts` answers Ambiguous for a name that means a whole Vendor by listing that Vendor's APIs.guru APIs, and gives up when there are fewer than two. APIs.guru has **no entries at all** for Mailchimp, Zoho, Intuit or Meta, and exactly one each for Atlassian and Cisco (checked live, 2026-09-22). Five Benchmark entries in the `ambiguous` group therefore cannot be answered correctly however the judgments are tuned: there is nowhere to get a second candidate from. Mailchimp currently answers `NoSpec` on a single portal Candidate.

The Vendors themselves publish the list. Mailchimp's developer portal names its Marketing API and Transactional API; Zoho's names dozens. The crawl built in #5 already visits those pages.

## Change
Add to `src/sources/crawl.ts` a second entry point that reuses the same fetching and link extraction:

```ts
export type VendorApiHit = { name: string; url: string };
export async function crawlForVendorApis(opts: {
  startUrl: string; vendor: VendorRef; fetcher: Fetcher; judge: Judge;
  maxPages?: number; budgetMs?: number; threshold?: number;
}): Promise<VendorApiHit[]>
```

- Depth 1 from the portal page, at most 4 pages, 15 s.
- Extract links as #5 does, then ask a new Judge question over them.
- **New judgment**: `isVendorApiLink(vendor: VendorRef, link: SpecLink)` and its batch form `areVendorApiLinks`, added to the `Judge` interface in `src/judge/judge.ts` and implemented in `JevJudge` and `FakeJudge`, with the wording in one exported constant like the others. It asks whether the link names one of this Vendor's distinct APIs (as opposed to a guide, a pricing page, an SDK or the portal's own navigation).
- Keep links at or above `threshold` (default 0.6), dedupe by the API name the Judge was shown (normalised), cap at 10, and return them in score order.

In `vendorCandidates` in `src/lookup/lookup.ts`:
- When APIs.guru gives fewer than two APIs for the Vendor **and** `isVendorName` is already at or above `thresholds.vendorName`, call the portal crawl from the Candidate's `portalUrl` (or `https://<vendor.domain>`) and build Candidates from what comes back: id `<vendorId>/<slugified name>`, name as given. Merge with any APIs.guru APIs by id.
- Still fewer than two → return `null` and keep today's answer, as now.
- Errors are diagnosed and treated as nothing found.

## Done when
- `src/judge/jev.test.ts` covers the new question's request shape and mapping, and the live smoke script prints `isVendorApiLink` for one example.
- `src/sources/crawl.test.ts`: links the fake Judge scores high become hits, in score order; duplicates by name collapse; the cap and the budget hold.
- `src/lookup/lookup.test.ts`: a Vendor with no APIs.guru APIs and a portal listing three of them answers Ambiguous over those three; a Vendor with two APIs.guru APIs does not crawl; a crawl returning one API leaves today's answer.
- `pnpm check` and `pnpm build` green.
