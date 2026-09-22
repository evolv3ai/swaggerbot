---
status: gate not met; awaiting label review
---

# Slice 2 result

All thirteen planned issues are merged, plus two filed mid-slice (WTR-54, WTR-55).
`main` = `e352af7`. Two live `pnpm bench` runs on 2026-09-22 (~16:00 and ~16:10),
fresh Index each, agreed on **every number and every one of the seventeen
failures**, so what follows is a measurement and not a sample.

| | Slice 1 accepted | Slice 2 now | Slice 2 target |
|---|---|---|---|
| False Resolution | 0.0% (0/9) | **33.3% (6/18)** | < 2% |
| Long-tail coverage | 27.3% | **45.5%** | 60% |
| Outcome accuracy | — | 72.5% | — |

| group | entries | correct | resolved | false |
|---|---|---|---|---|
| popular | 12 | 10 | 10 | 3 |
| longtail | 12 | 9 | 8 | 3 |
| ambiguous | 10 | 5 | 0 | 0 |
| negative | 6 | 5 | 0 | 0 |

The chain got substantially better at *finding* Specs — coverage nearly doubled,
and Resolved went from 9 to 18 entries — and the gate moved the wrong way for a
reason that needs a person, not a threshold.

## The gate fails on six entries, and five of them look right

Every false resolution is the same shape: **"wrong Spec Source: X is not in
`specSources`"**. The Spec found is real and served by the Vendor; it is simply
not one of the URLs the Benchmark entry lists. This is the situation Wes ruled on
twice in Slice 1 (Stripe's legacy Source, Supabase's second Official Source), and
it needs the same ruling here. **Nothing has been added to `benchmark/entries.json`.**

| Entry | Source found | Reading |
|---|---|---|
| Cloudflare API | `developers.cloudflare.com/openapi.json` | Cloudflare's own documentation host. Looks like a legitimate second Official Source. |
| Novu | `docs.novu.co/openapi.json` | The Vendor's own docs host. Same shape. |
| Infisical | `infisical.com/openapi.json` | The Vendor's own domain. Same shape. |
| Box Platform API | `box/box-openapi` → `openapi/openapi-v2026.0.json` | The Vendor's own repo, a dated release file. Probably the current Spec under a name the entry doesn't list. |
| Firecrawl | `firecrawl/firecrawl` → `apps/api/openapi.json` (run 1: `v1-openapi.json`) | The Vendor's own repo, but the **two runs picked different files**. Worth settling which is current before accepting either. |
| PagerDuty REST API | `PagerDuty/api-schema` → `reference/events-v2/openapiv3.json` (run 1: `events-v1/`) | **Genuinely wrong**: the Events API, not the REST API, and unstable between runs. A ranking problem, not a labelling one. |

So five are candidates for accepting as correct Sources; PagerDuty is a real
defect. Until Wes rules, the gate number is not meaningful.

## The eleven non-Resolved failures, by cause

**Already diagnosed, recorded on their issues:**

- **Mailchimp, Zoho, Intuit** (expected Ambiguous, got NoSpec). WTR-51 built the
  Vendor-API crawl, and it never runs: step 4 in `findSpec` is guarded by
  `verdict?.kind === "unknown"`, and for a bare Vendor name the Judge confidently
  identifies a single API instead. A judgment question — should one Candidate from
  a bare Vendor name count as identified? — not a threshold. See WTR-51.
- **Neon API** (expected Resolved, got Ambiguous). Not the redirect problem WTR-50
  assumed. `api-docs.neon.tech` is a live ReadMe-hosted reference Neon still runs;
  it doesn't redirect, so `neon.tech` and `neon.com` are two real domains of one
  Vendor. Needs Vendor identity, and `neoncrm.com` is a *different company*, so the
  rule has to tell those apart. See WTR-50.
- **Mux** (expected Resolved, got NoSpec) — but `lookup({ name: "Mux Video API" })`
  **is** Resolved Official on `www.mux.com/api-spec.json` (845,959 bytes), verified
  live after WTR-55. The Benchmark asks for the bare name "Mux", which hits the same
  umbrella gate as Mailchimp. One fix likely covers both.

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
unused, and the next person would reasonably assume it isn't.

## What to do next

1. **Wes rules on the five plausible Sources** above; add the accepted ones to
   `benchmark/entries.json` with a note saying who accepted them and when, as
   Slice 1 did. Then re-run and see what the gate really says.
2. **Fix PagerDuty's ranking** — the Events Spec beating the REST one, unstably.
3. **Settle the umbrella-name question** (Mailchimp/Zoho/Intuit/Mux/Atlassian/Cisco).
   It is the single biggest block of failures and one decision covers them all.
4. Then tune `src/lookup/thresholds.ts` on the reviewed entries — tuning before the
   labels are settled would fit the thresholds to wrong answers.
