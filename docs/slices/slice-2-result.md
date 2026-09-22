---
status: gate not met; WTR-57..62 merged, WTR-56 held; three label questions for Wes
---

# Slice 2 result

All thirteen planned issues are merged, plus WTR-54 and WTR-55 (filed mid-slice), and
after the label review WTR-57..62. **WTR-56 is built (PR #36) but held** (see below).
`main` = `df75e21`. Two live `pnpm bench` runs on that `main`, 2026-09-22 ~18:00 and
~18:20, fresh Index each:

| | Slice 1 accepted | Slice 2 before review | After review | **After WTR-57..62** | Slice 2 target |
|---|---|---|---|---|---|
| False Resolution | 0.0% (0/9) | 33.3% (6/18) | 21.1% (4/19) | **15.0% (3/20), 10.0% (2/20)** | < 2% |
| Long-tail coverage | 27.3% | 45.5% | 63.6% | **72.7%** (both runs) | 60% |
| Outcome accuracy | — | 72.5% | 75.0% | **77.5%** (both runs) | — |

| group | entries | correct | resolved | false (run 1 / run 2) |
|---|---|---|---|---|
| popular | 12 | 11 | 11 | 2 / 1 |
| longtail | 12 | 10 | 9 | 1 / 1 |
| ambiguous | 10 | 5 | 0 | 0 |
| negative | 6 | 5 | 0 | 0 |

**Coverage is met; the precision gate is not, but it is close.** Of the false
resolutions, two (Box, Neon, in both runs) are **label questions**: each resolves to
an Official URL serving the labelled Spec. If Wes accepts them, run 2 has 0/20. The
third (GitHub, run 1 only) is a new intermittent defect, WTR-65.

## Label questions for Wes (from this round)

| Entry | Source found | Finding |
|---|---|---|
| Neon API | `neon.com/openapi.json` | **Byte-identical** to the labelled `neon.com/api_spec/release/v2.json` (same SHA-256) |
| Box Platform API | `developer.box.com/box-openapi.json` | Same title, 2024.0, server `api.box.com/2.0`, and all 187 path keys as the labelled `openapi.json`; only the rendered description text differs (markdown bullets, relative links) |
| Novu | `api.novu.co/openapi.yaml` | The same document as the labelled `openapi.json` once parsed; seen in 1 of 3 live runs, not in the Benchmark |

Precedents: Supabase (a second Official URL serving the same document) and
Cloudflare (same version and server) were accepted.

## WTR-56..62 round (2026-09-22)

Each PR was verified merged with current `main` and live-checked with keys from
that worktree:

- **WTR-61** (#32): Novu picks 3.19.2 over the stale `docs.novu.co` copy. That
  surfaced `api.novu.co/api-json`, titled "DEPRECATED … Use /openapi.{json,yaml}
  instead" at the same version, which won on pool order in some runs → **WTR-62**
  (#38): a Spec whose Vendor marks it deprecated isn't Current. After both: 3 of 3 runs avoid `api-json`.
- **WTR-59** (#33): Firecrawl → `docs.firecrawl.dev/api-reference/v2-openapi.json`.
- **WTR-57** (#34): wires WTR-52's `searchSpecRepos`/`specsInRepo` (no longer
  unused). As built it found PagerDuty's REST Spec but still settled on an Events
  Spec fetched first; the reviewer added "fetch GitHub hits likeliest first".
- **WTR-58** (#35): Box Current 2024.0, not the 5-path 2026.0 add-on. Also rules
  out PagerDuty's 1-path Events v1, whose date version outranked REST's 2.0.0.
  PagerDuty REST API is correct in both Benchmark runs. The rule doesn't reach
  Index answers (WTR-64, needs a design call).
- **WTR-60** (#37): Neon resolves (apex redirect `neon.tech` → `neon.com`).
- **WTR-56** (#36), **held**: Mailchimp → Ambiguous as intended, but Zoho and Intuit
  stay NoSpec and **Plaid regresses to Ambiguous** over ten product pages ("Transfer:
  ACH, RTP…", "Balance: real-time…"), because the WTR-51 Vendor crawl can't tell
  one API's products from separate APIs. Needs a decision; evidence on WTR-56.

**Thresholds were not tuned.** No remaining failure turns on a threshold: they are
label questions, a merge/tie defect, crawl and identity gaps, and undiagnosed cases.

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

## Remaining failures, by cause (run 2)

- **Box, Neon**: label questions above.
- **GitHub REST API** (run 1 only): resolved to GitHub Enterprise Cloud's
  `ghec.2022-11-28.json`. APIs.guru's 20 `github.com` entries share one name, so
  `mergeGuruChoices` puts GHEC's origins in GitHub's Choice, all at 1.1.4; the order
  flip isn't explained yet. WTR-65.
- **Mailchimp, Zoho, Intuit** (expected Ambiguous, got NoSpec): WTR-56, held.
- **Mux** (expected Resolved, got NoSpec in both runs, and live on `main`): resolved
  once after the label review; not diagnosed.
- **Slack Web API** (Unconfirmed): its Spec is in `slackapi/slack-api-specs`; the
  org is `slackapi` while the Vendor label is `slack`, and a link to a GitHub repo
  page sniffs as HTML.
- **Render API** (NoSpec), **Atlassian, Cisco** (Unknown; fewer than two APIs.guru
  entries), **Steam Web API** (a negative entry answering Ambiguous): not diagnosed.

## What to do next

1. Wes: rule on the three label questions and on WTR-56 (Plaid).
2. WTR-65 first step: log the pool for a failing GitHub run.
3. Then two more `pnpm bench` runs; with the label rulings accepted and WTR-65
   fixed, the gate is within reach.
4. Undiagnosed: Mux, Slack, Render, Atlassian, Cisco, Steam Web API. WTR-64 (Index
   answers) needs a design call.
