---
status: gate not met; labels reviewed, every false resolution has an issue (WTR-56..61)
---

# Slice 2 result

All thirteen planned issues are merged, plus two filed mid-slice (WTR-54, WTR-55).
`main` = `d140a87` plus the label review below. Two live `pnpm bench` runs on
2026-09-22 before the review (~16:00 and ~16:10) agreed on every number; two after
it (~17:00 and ~17:20, fresh Index each) are below.

| | Slice 1 accepted | Slice 2 before review | Slice 2 after review | Slice 2 target |
|---|---|---|---|---|
| False Resolution | 0.0% (0/9) | 33.3% (6/18) | **21.1% (4/19)** | < 2% |
| Long-tail coverage | 27.3% | 45.5% | **63.6%** | 60% |
| Outcome accuracy | — | 72.5% | 75.0% | — |

| group | entries | correct | resolved | false |
|---|---|---|---|---|
| popular | 12 | 10 | 10 | 2 |
| longtail | 12 | 10 | 9 | 2 |
| ambiguous | 10 | 5 | 0 | 0 |
| negative | 6 | 5 | 0 | 0 |

**The coverage target is met; the precision gate is not.** The four remaining false
resolutions are all real defects with a known cause, each filed.

## Label review (Wes, 2026-09-22)

Each Source the Lookup found but the entry didn't list was compared with the
labelled Spec (version, servers, path count) before asking:

| Entry | Source found | Finding | Ruling |
|---|---|---|---|
| Cloudflare API | `developers.cloudflare.com/openapi.json` | Same v4.0.0, same server, 2233 vs 2241 paths | **Accepted**, added to `entries.json` |
| Infisical | `infisical.com/openapi.json` | Same version, same 1510 paths | **Accepted** |
| Mux | `www.mux.com/full-combined-spec.json` | Strict superset: all 115 paths plus 9 playback/image paths (surfaced by the first post-review run) | **Accepted** |
| Novu | `docs.novu.co/openapi.json` | The Vendor's own, but 3.15.0 vs 3.19.2 (93 vs 102 paths) | **Not accepted**: a stale copy stays wrong. Cause found: WTR-61 |
| Box Platform API | `openapi/openapi-v2026.0.json` | **5 paths.** Box's per-version files hold only the endpoints new in that version; `openapi.json` (2024.0, 187 paths) is the API | A defect: WTR-58 |
| Firecrawl | `apps/api/openapi.json` or `v1-openapi.json` | Both **v1**; the docs serve `api-reference/v2-openapi.json`, named only in the page's embedded config | A defect: WTR-59 |
| PagerDuty REST API | `reference/events-v1/` or `events-v2/` | The REST Spec is 2.7 MB, beyond code search's index, so it is never a hit; WTR-52's `specsInRepo` would list it and is called by nothing | A defect: WTR-57 |

Two structural rulings from the same review:

- **A bare Vendor name always runs the whole-Vendor step** (one API → its Spec,
  several → Ambiguous). WTR-56. Covers Mailchimp, Zoho, Intuit; watch the
  single-word Resolved entries for regressions.
- **Vendor identity is derived from evidence, not a curated alias list.** For Neon:
  `neon.tech`'s apex redirects to `neon.com`, while `neoncrm.com`'s goes to
  `neonone.com`. WTR-60.

## The ten non-Resolved failures, by cause

**Already diagnosed, recorded on their issues:**

- **Mailchimp, Zoho, Intuit** (expected Ambiguous, got NoSpec). WTR-51 built the
  Vendor-API crawl, and it never runs: step 4 in `findSpec` is guarded by
  `verdict?.kind === "unknown"`, and for a bare Vendor name the Judge confidently
  identifies a single API instead. A judgment question — should one Candidate from
  a bare Vendor name count as identified? — not a threshold. See WTR-51. **Ruled
  2026-09-22: always run the whole-Vendor step; WTR-56.**
- **Neon API** (expected Resolved, got Ambiguous). Not the redirect problem WTR-50
  assumed. `api-docs.neon.tech` is a live ReadMe-hosted reference Neon still runs;
  it doesn't redirect, so `neon.tech` and `neon.com` are two real domains of one
  Vendor. Needs Vendor identity, and `neoncrm.com` is a *different company*, so the
  rule has to tell those apart. See WTR-50. **Ruled 2026-09-22: identity from
  evidence (the apex redirect); WTR-60.**
- **Mux** was NoSpec before the review; after it, it resolves on
  `www.mux.com/full-combined-spec.json`, accepted as correct (see the label review).
  WTR-56 may change how the bare name "Mux" is routed, so watch it.

**Not yet diagnosed:**

- **Slack Web API** (Unconfirmed on the APIs.guru mirror). Its Spec is in
  `slackapi/slack-api-specs`, linked from Slack's docs — the org is `slackapi` while
  the Vendor label is `slack`, so the org-scoped GitHub search misses it. A link to a
  GitHub *repo page* also passes `isSpecCandidate` (it contains `api-spec`) but sniffs
  as HTML, so the crawl drops it rather than resolving repo → raw Spec file.
- **Asana** (Unconfirmed), **Render API** (NoSpec) — not investigated.
- **Atlassian, Cisco** (expected Ambiguous, got Unknown) — the Vendor has fewer than
  two APIs.guru entries, same family as Mailchimp.
- **Steam Web API** (expected NoSpec, got Ambiguous) — a negative entry now answering
  Ambiguous; check nothing over-eager crept in.

## Also unfinished

`searchSpecRepos` and `specsInRepo` (WTR-52, built for Cloudflare's 26 MB Spec that
code search cannot index) are **exported, tested and called by nothing**. WTR-47's
issue predated them and wires only `searchSpecs`. Cloudflare resolves anyway by
another route, so nothing is broken — but the capability the slice paid for is
unused, and the next person would reasonably assume it isn't. **It is also why
PagerDuty fails** (its 2.7 MB REST Spec is never a code-search hit); WTR-57 wires it.

## What to do next

1. **Merge WTR-56..61** (all in Backlog, each with a named live check). 57 also
   closes the unused-WTR-52 gap above. Run each PR's live check with keys before
   merging: agents' worktrees have none.
2. Re-run `pnpm bench` twice and update this document in place.
3. Only then tune `src/lookup/thresholds.ts` on the reviewed entries.
4. Still undiagnosed: Slack (Unconfirmed), Asana (Unconfirmed), Render (NoSpec),
   Atlassian and Cisco (Unknown), Steam Web API (a negative entry answering
   Ambiguous).
