---
status: gate not met (FR 1/22 and 1/21); coverage 90.9%; round 3 merged (WTR-56, 64, 65, 79, 80, 81, 84)
---

# Slice 2 result

All thirteen planned issues are merged, plus WTR-54 and WTR-55 (filed mid-slice), WTR-57..62
after the label review, and in round 3 **WTR-56, 64, 65, 79, 80, 81 and 84**. `main` =
`5126aec`. Two live `pnpm bench` runs on that `main`, 2026-09-22, finished ~20:55 and ~20:59, fresh
Index each:

| | Slice 1 accepted | Slice 2 before review | After review | After WTR-57..62 | **After round 3** | Slice 2 target |
|---|---|---|---|---|---|---|
| False Resolution | 0.0% (0/9) | 33.3% (6/18) | 21.1% (4/19) | 15.0% (3/20), 10.0% (2/20) | **4.5% (1/22), 4.8% (1/21)** | < 2% |
| Long-tail coverage | 27.3% | 45.5% | 63.6% | 72.7% | **90.9%** (both runs) | 60% |
| Outcome accuracy | — | 72.5% | 75.0% | 77.5% | **85.0%, 80.0%** | — |

| group | entries | correct (run 3 / 4) | resolved | false (run 3 / 4) |
|---|---|---|---|---|
| popular | 12 | 11 / 11 | 11 / 11 | 0 / 1 |
| longtail | 12 | 12 / 11 | 11 / 10 | 1 / 0 |
| ambiguous | 10 | 6 / 5 | 0 | 0 |
| negative | 6 | 5 / 5 | 0 | 0 |

**The precision gate is one entry away, and a different entry in each run.** Run 3's
false resolution is **Loops → `app.loops.so/openapi.yaml`**, a label question: it is the
same document as the labelled `openapi.json` (version 1.21.14, 43 paths, same server; the
parsed documents differ only where a YAML reader turns unquoted dates into dates), the
same case as Novu's `openapi.yaml`, accepted. **Wes accepted it, 2026-09-22**, so run 3
scores **0/22** under the current labels. Run
4's is **Box → `box-openapi-v2025.0.json`** (2025.0, 24 paths, over the 187-path 2024.0
Spec), a real intermittent defect: 2 of 4 Benchmark runs across two `main`s, 0 of 5 traced
live Lookups, which all fetch the 187-path file first and answer 2024.0. Not diagnosed;
WTR-85 proposes the Benchmark trace needed to catch it.

The GitHub → GHEC false resolution (WTR-65) is gone: 4 of 4 Benchmark runs and 3 of 3
live Lookups answer `api.github.com.json`.

## Round 3 (2026-09-22 evening)

Each PR was verified merged with current `main` in a clean worktree and live-checked
with keys from it (`scripts/lookup.ts`, committed this round):

- **WTR-65** (#39): APIs.guru group members' origins merge only from the
  representative's origin directory (GitHub keeps `api.github.com/`, drops `ghec/`,
  `ghes-*/`, `github.ae/`); a same-version tie goes to the earliest origin URL, not the
  Judge's probability, which varies between calls. Live: 3 of 3 correct.
- **WTR-56** (#36, reworked): a bare Vendor name runs the whole-Vendor step (Wes's
  rule), and when the Vendor API crawl names several APIs, the identified API's Spec
  answers if more than half of their names match its first path segments or tags
  (Wes, 2026-09-22). Live: Plaid Resolved ("8 of 10 API names are covered"),
  Mailchimp Ambiguous, Stripe, Replicate, Loops, Asana, Novu, Infisical still Resolved.
- **WTR-80** (#40): web-search portal Candidates skip shared-hosting tenants
  (`*.azurewebsites.net`, `*.github.io`, …). Steam loses its top Candidate but stays
  Ambiguous between `steamcommunity.com` and `steamgames.com` (no shared apex).
- **WTR-79** (#41): the embedded-Spec extractor accepts `openapi`/`swagger` in any
  path segment and reads `<pre>`/`<code>`. Render's page names its Spec only there.
- **WTR-64** (#42): option 1, decided by Wes. The Index stores path count, deprecated
  and origin rank per Spec (migration 0003), and fresh and Index answers rank with one
  `currentAndFull`. Live: Box asked twice on one Index → 2024.0 both times, the second in 1 s.
- **WTR-84** (#43, new): Cisco's and Supabase's "Jev returned HTTP 403" was Cloudflare's
  WAF in front of TypeSafe blocking APIs.guru descriptions that carry `curl` examples,
  not the key or quota. A blocked call is retried with shortened, then no, free text.
  Live: no 403s; Supabase Management API Resolved.
- **WTR-81** (#44): GitHub orgs come from the Vendor's own links, verified by the org's
  website (`render-examples`, `render-oss` for Render); a 422 on an `org:` search means
  no such org, not a failed search. Neither entry flips on it (Render's Spec isn't on
  GitHub; Slack's crawl starts at `slack.com`, which links no org).
- **Slack relabel** (`e4507d9`, Wes): `specSources` → `api.slack.com/specs/openapi/v2/slack_web.json`
  (1.7.0, 170 paths; the GitHub repo is archived since 2021-09-07). The Lookup can't
  find it: **no live page links it** (the page that did now lands on `docs.slack.dev/404`).
  Filed for a decision: WTR-83.

Agent cost this round about $10.50 (65 $1.14, 79 $0.79, 80 $0.55, 64 $2.09, 84 $1.14,
81 $2.03, 56 $2.74 including its first run).

## Remaining failures, by cause (runs 3 and 4)

- **Loops** (run 3): label question above; accepted by Wes 2026-09-22, no longer a failure.
- **Box** (run 4): intermittent, undiagnosed; WTR-85.
- **Slack Web API** (Unconfirmed, both): its Spec is linked from no live page. WTR-83:
  Wes chose option 1 (2026-09-22): keep the label and accept it as a coverage miss.
  Unconfirmed is not a False Resolution, so it doesn't touch the gate.
- **Render API** (NoSpec, run 4): intermittent. The crawl finds the label from
  `render.com/docs/api` in every traced Lookup (10 of 10), but plain ones answer NoSpec
  about half the time; not explained yet. WTR-85's trace would show which step differs.
- **Mailchimp** (NoSpec, run 4 only): intermittent; the crawl found fewer than two APIs.
- **Atlassian** (Unknown): its only APIs.guru Candidate is Jira (0.51), below `apiPick`.
- **Cisco** (Unknown): the 403 is fixed; its only Candidate, PSIRT openVuln, is at 0.56.
- **Zoho, Intuit** (NoSpec): the Vendor API crawl finds nothing.
- **Steam Web API** (Ambiguous, negative): Valve's two domains don't share an apex.

**Thresholds were not tuned**: the one threshold-shaped failure pair (Atlassian 0.51,
Cisco 0.56 for single Candidates) wants Ambiguous, which a lower `apiPick` wouldn't give.

## What to do next

1. ~~Wes: accept Loops' `openapi.yaml`; decide WTR-83~~ Done 2026-09-22: Loops accepted,
   Slack stays a coverage miss.
2. Queue WTR-85 (Benchmark trace), then catch Box and Render failing with it.
3. Then two more `pnpm bench` runs; with Loops accepted and Box fixed, the gate is met.
4. Later: Atlassian, Cisco (single-Candidate umbrella names), Zoho, Intuit (crawl finds
   nothing), Steam (one Vendor across two domains).

## Label questions from this round (all three **accepted** by Wes, 2026-09-22; added to `entries.json`)

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
- **WTR-56** (#36), **held** (merged after rework in round 3): Mailchimp → Ambiguous as intended, but Zoho and Intuit
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
