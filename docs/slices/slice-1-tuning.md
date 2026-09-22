# Slice 1 tuning round

Slice 1's code is merged (WTR-24..33), but its acceptance run fails. This round fixes what the first live Benchmark run showed. Each body below is filed on Linear as-is (team WTR, labels `ai` + `swaggerbot`), in the same shape as [`slice-1-backlog.md`](slice-1-backlog.md).

## Where it stands (live run, 2026-09-22, Brave, 40 entries)

Scored the way this round's first issue will score it (the right Vendor plus a Spec Source in `specSources`):
- **False Resolution 3/9 (33%)**: all three are the right Vendor with a stale Source. Asana came from the archived `AsanaArchive/developer-docs`, OpenAI from the non-default `master` branch, and Stripe from the legacy `openapi/spec3.yaml` where the repo README recommends `latest/`.
- **Longtail coverage 2/12; Outcome accuracy 16/40.** Median Lookup 1.5 s.
- Other failures, by cause:
  - Ambiguous from aggregator or duplicate portal Candidates: Mux, Neon, Novu, GitHub REST API, and the negatives Reddit, Dropbox and Steam.
  - Umbrella names not recognised: Mailchimp, Zoho, Cisco (and "google", filed under `googleapis.com`).
  - The Spec not found on the identified Vendor: 7 longtail entries, Cloudflare and PagerDuty. **Not in this round**: finding Specs through the Developer Portal is Slice 2 work.
  - Mirror-only answers (Box, Slack): correctly Unconfirmed; left alone.

Stripe stays a known False Resolution after this round. Code can't infer from APIs.guru's link that the Vendor recommends `latest/`. It needs either human curation of the Index (a PRD "Later" item) or a Benchmark decision.

| # | Linear | Issue | Depends on |
|---|---|---|---|
| T1 | WTR-37 | Score Resolved answers on Vendor + Spec Source | — |
| T2 | WTR-38 | Skip archived GitHub repos and non-default branches | — |
| T3 | WTR-39 | Clean up portal Candidates | — |
| T4 | WTR-40 | Recognise umbrella names beyond the domain label | T3 |

After these merge, run `pnpm bench` live, tune `src/lookup/thresholds.ts` by hand on the reviewed entries, and record the result here.

---

## T1. swaggerbot: score Resolved answers on Vendor + Spec Source

## Problem
`falseResolutionReason` in `src/benchmark/score.ts` counts a Resolved answer as wrong unless `outcome.api.id` equals the entry's `apiId` exactly. API ids are slugs the pipeline derives from APIs.guru keys or search titles (`twilio.com/twilio-verify-v2`, `asana.com/asana`), and they never match the Benchmark's hand-made slugs (`twilio.com/verify`, `asana.com/asana-api`). On the live run, 5 of 8 "False Resolutions" were correct answers under a different slug.

## Change
A Resolved answer is correct when both of these hold:
- its Vendor id (`outcome.vendor.id`) equals the Vendor part of the entry's `apiId` (the text before the first `/`);
- one of its `sources` URLs matches `specSources` (the existing `normalizeUrl` comparison).

The failure reasons become `wrong Vendor: got X, expected Y` and the existing `wrong Spec Source: …`. `apiId` stays required on Resolved entries (it carries the Vendor), and nothing else in the entry schema changes. Update the doc comment on `specSources` in `src/benchmark/entry.ts` and the "Benchmark" line in `README.md` if it describes scoring.

## Done when
- `src/benchmark/score.test.ts`: a Resolved answer with a different API slug but the same Vendor and a listed Source is correct; a different Vendor is a False Resolution even when the URL is listed; the right Vendor with an unlisted Source is a False Resolution; the existing cases still pass.
- `pnpm check` and `pnpm build` green.

---

## T2. swaggerbot: skip archived GitHub repos and non-default branches as Spec Sources

## Problem
APIs.guru's `originUrls`, which the Lookup in `src/lookup/lookup.ts` fetches first (`fetchAndConsider`), are often stale GitHub raw URLs. On the live run this caused two False Resolutions:
- **Asana:** `raw.githubusercontent.com/Asana/developer-docs/master/defs/asana_oas.yaml`. That repo has moved to `AsanaArchive/developer-docs` and is archived; the current Spec is in `Asana/openapi`.
- **OpenAI:** `raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml`. The repo's default branch is `main`; `master` still serves a stale copy.

## Change
Add `src/sources/github.ts`: `createGitHubRepos({fetchJson, token?})` → `repoInfo(owner, repo)` → `{fullName, defaultBranch, archived}`, or `null` on failure. It calls `GET https://api.github.com/repos/{owner}/{repo}` with the header `Authorization: Bearer $GITHUB_TOKEN` when the env var is set (optional; add it to `.env.example`). Results are cached in memory for 24 h. On 403/429 or a network error it returns `null` and logs once.

In the Lookup, before fetching a Spec Candidate whose URL is `raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`:
- Look up the repo, following the redirect GitHub returns for a moved repo (use the returned `full_name`).
- **Archived** → don't use the Source. Add a diagnostic `archived repo {full_name}` and move on to the next Candidate. An archived repo's Spec is never Resolved.
- **`ref` is not the default branch** → fetch `raw.githubusercontent.com/{full_name}/{defaultBranch}/{path}` instead. If that 404s, fall back to the original URL. Record the URL actually used as the Source.
- `repoInfo` returned `null` → keep today's behaviour.

Official-vs-Mirror by GitHub org stays as it is (the Vendor id's first label), but compare it against `full_name`'s owner after a redirect.

## Done when
- `src/sources/github.test.ts` stubs `fetchJson`: mapping, caching, the token header when set, and `null` on 403.
- `src/lookup/lookup.test.ts` with a fake `GitHubRepos`: an archived origin is skipped with the diagnostic; a `master` URL on a `main` repo is fetched from `main`; a failed rewrite falls back; `null` info changes nothing.
- `pnpm check` and `pnpm build` green.

---

## T3. swaggerbot: clean up portal Candidates

## Problem
Portal Candidates from `findPortalCandidates` (`src/sources/portal.ts`) turned clear names into Ambiguous on the live run:
- **Aggregators get through the exclusion list:** `apitracker.io` (Mux, Novu, Reddit, Dropbox), `npmjs.com` (Novu), `hexdocs.pm` (Mux), `openbankingtracker.com` and `*.readthedocs.io` (seen in the Brave smoke test).
- **One Vendor appears as several Candidates.** "Neon API" split 0.36/0.36 between `neon.com/neon-api-neon-docs` and `neon.tech/neon-api-reference`, and `neon.tech` redirects to `neon.com`. Several pages on one domain become separate APIs too.
- **Ids come from search-result titles** (`loops.so/api-introduction-loops`, `val.town/overview-docs`), so they are unstable and read badly.

## Change
In `src/sources/portal.ts`:
- Add `apitracker.io`, `npmjs.com`, `hexdocs.pm`, `pkg.go.dev`, `pypi.org`, `openbankingtracker.com`, `readthedocs.io` and `readthedocs.org` to `NON_VENDOR_DOMAINS`, matching subdomains too (`mercury-docs.readthedocs.io`).
- Keep at most one Candidate per registrable domain (the highest-ranked result).

In the Lookup, where portal Candidates become Candidate APIs (`src/lookup/lookup.ts`):
- Fetch each portal URL's origin once with the fetcher. When the final URL's registrable domain differs (a redirect), use the final domain, and merge Candidates that end up on the same domain.
- Name a portal-derived API after its Vendor, not the page title: the API id is `<vendorId>/api` and the name is `<Brand> API`, where Brand is the domain's first label capitalised. When APIs.guru already has a Candidate for that Vendor, drop the portal Candidate.

## Done when
- `src/sources/portal.test.ts`: the new exclusions (including a subdomain), and one Candidate per domain.
- `src/lookup/lookup.test.ts` with the fake search and a fixture server: two domains, one redirecting to the other, become one Candidate; a portal Candidate for a Vendor APIs.guru already has is dropped; portal ids are `<vendorId>/api`.
- `pnpm check` and `pnpm build` green.

---

## T4. swaggerbot: recognise umbrella names beyond the domain label

## Problem
The umbrella rule in `umbrellaCandidates` (`src/lookup/lookup.ts`) fires only when the name equals the first label of a Vendor id and at least 2 Candidates share that Vendor. On the live run it missed:
- **"Google":** APIs.guru's Vendor is `googleapis.com`.
- **Mailchimp and Zoho:** they came back NoSpec on a single portal Candidate.
- **Cisco:** Unknown, with one APIs.guru Candidate at 0.60.

## Change
- **Prefix match:** the rule also fires when the first label of a Vendor id starts with the name and the rest is `apis` or `api` (`google` ↔ `googleapis.com`). Keep the ≥2-Candidates condition.
- **Ask Jev whether the name is a company:** add `isVendorName(name, vendor: {id, name})` to the Judge interface (`src/judge/judge.ts`). It's a `noul` that asks whether the name refers to the company as a whole rather than one of its APIs, with the wording in one exported constant like the others. Implement it in `JevJudge` and `FakeJudge`. In the Lookup, when `whichApi` leaves the answer unsettled (Unknown by `none`, or a single Candidate below `apiPick`) and the top Candidate's Vendor gets `isVendorName` ≥ `thresholds.vendorName` (default 0.7), answer Ambiguous with that Vendor's APIs.guru APIs (up to 10, equal probabilities) when it has at least 2. Otherwise keep today's answer.
- Add `vendorName` to `Thresholds` with that default.

## Done when
- `src/lookup/lookup.test.ts`: "google" with two `googleapis.com` Candidates → Ambiguous without calling `whichApi`; a vendor name judged 0.9 with three APIs.guru APIs → Ambiguous; judged 0.9 but with one API → today's Outcome; judged 0.3 → today's Outcome.
- `src/judge/jev.test.ts` covers the new question's request and mapping, and the live smoke script prints `isVendorName("mailchimp", …)`.
- `pnpm check` and `pnpm build` green.

---

## Result (2026-09-22, after WTR-37..40 merged)

Live `pnpm bench`, Brave, all 40 entries, about 86 s:

| | Before the round | After WTR-37..40 | + hand tuning (`apiPick` 0.75 → 0.7) |
|---|---|---|---|
| False Resolution | 8/9 (89%; 3/9 = 33% under the new scoring) | 1/8 (12.5%) | **1/9 (11%)** |
| Longtail coverage | 0/12 | 2/12 | **3/12** |
| Outcome accuracy | 47.5% | 47.5% | **50%** |

- **The only False Resolution left is Stripe** (legacy `openapi/spec3.yaml` rather than the recommended `latest/`). The gate stays failed until that's decided: either curate the Index or relax the label. Every other failure is a safe miss (Unconfirmed, NoSpec or Ambiguous), which is what the precision-over-coverage principle asks for.
- **What the round fixed:** OpenAI (branch rewrite); Asana and Slack now go to Unconfirmed on their archived repos rather than resolving; Novu, Replicate and Loops now resolve; Reddit and Dropbox are correct NoSpec; Google, Azure and Cisco are Ambiguous.
- **Hand tuning:** only `apiPick` moved (it fixed Loops at 0.72, with no new False Resolution). `vendorName` at 0.65 changed nothing, so it stays at 0.7. `apis.io` was added to `NON_VENDOR_DOMAINS` (it showed up as a Cisco Candidate).
- **Still open, not threshold problems:**
  - Mailchimp, Zoho and Intuit return NoSpec: `whichApi` picks their single portal Candidate outright, so the vendor-name check (which only runs when unsettled) never fires.
  - Atlassian returns Unknown.
  - Neon is still split between `neon.tech` and `neon.com`, although the fetcher follows the redirect.
  - GitHub REST API is split between two APIs.guru entries.
  - Steam picks up third-party hosts.
  - 9 longtail/popular entries need Spec finding beyond known paths (Slice 2).
- **Latency:** most Lookups take 1.5–4 s, but some Discovery runs took 16–19 s (Mux, Dropbox) with the extra portal fetches. That's over the 15 s p90 target, which is Slice 3's to meet.
