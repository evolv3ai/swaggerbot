# swagger.bot — Product Requirements (v2)

_Supersedes the May 2025 BMAD documents. Vocabulary is defined in [`CONTEXT.md`](../CONTEXT.md); capitalised terms below (Lookup, Spec, Provenance…) mean exactly what the glossary says. Architectural decisions are in [`adr/`](adr/)._

## Problem

Finding the OpenAPI or Swagger Spec for a given API means hunting through Developer Portals, GitHub organisations and directories, and then guessing whether what you found is official, current, and actually the API you meant. Directories such as APIs.guru cover popular APIs but not the long tail. AI agents are worse at this than people: they will confidently build on a hallucinated URL or a third-party copy.

## Product

swagger.bot turns the name of an API into a verified Spec with its Provenance, or says honestly why it can't. It answers from a growing Index of verified Specs and runs Discovery on the live web only when the Index can't answer.

**Principle: precision over coverage.** An Ambiguous, Unconfirmed or No Spec answer is always better than a False Resolution.

## Callers

| Caller | Surface | v1 priority |
|---|---|---|
| AI agents (Claude Code and others) | MCP server | Primary |
| Programs, platform teams | HTTP API | Primary |
| People | Web UI | Secondary — the public shop window and Index browser |

## Success metrics

Measured against the **Benchmark** (about 150 labelled names: about 50 popular APIs, about 50 long-tail APIs, about 30 ambiguous names or Vendors with several APIs, and about 20 negatives).

| Metric | Target |
|---|---|
| False Resolution rate (share of Resolved answers that are wrong) | **< 2%**, the release gate |
| Coverage: correct Resolved answers on the long-tail set | ≥ 60% |
| Outcome accuracy across all Benchmark entries | Tracked, no gate in v1 |
| Latency, answer from the Index | p90 < 200 ms |
| Latency, Discovery | p90 < 15 s |

Judgment thresholds are tuned on the Benchmark, never by hand-picking examples.

## Behaviour

### Lookup
- Input: a name, plus optional `apiVersion`, `allowCommunity` (default false) and `fresh` (default false).
- Output: exactly one Outcome — **Resolved**, **Ambiguous**, **Unconfirmed**, **No Spec** or **Unknown**:
  - **Resolved** returns the API, Vendor, Current Spec, Alternate Specs, Provenance, Sources, Validity Issues, `verifiedAt`, and download URLs for the Published Form and Normalized Form.
  - **Ambiguous** returns the candidate APIs with their probabilities.
  - **Unconfirmed** returns the Spec plus the reasons for doubt.
  - **No Spec** says whether Community Specs exist.
- A Lookup never silently picks between plausible APIs, and never returns Preview Versions or Superseded Specs by default.
- Community Specs are returned only when `allowCommunity` is set.

### Index and Verification
- A Lookup answers from the Index whenever it can, immediately.
- A Stale entry is still returned, and a background Verification is queued.
- `fresh: true` waits for a live Verification instead.
- Every answer carries `verifiedAt`.

### Discovery
The Source chain runs in order and stops when the Outcome is settled:
1. Index
2. APIs.guru
3. Finding the Developer Portal with a web search API
4. Checking the Vendor's domain: known paths, `apis.json`, then a shallow crawl of the Developer Portal
5. GitHub code search: the Vendor's organisation first, then everywhere else

Code retrieves Candidates; Jev judges them (ADR 0001). Low-confidence judgments come back to the Caller as Ambiguous or Unconfirmed. They are never escalated to an LLM on the server.

Crawling etiquette:
- respect `robots.txt`, with the one exception in [ADR 0003](adr/0003-robots-txt-exception-for-vendor-linked-specs.md): a single Spec document on the Vendor's own host — linked from an allowed Vendor page, or at a known path on the Vendor's API host — is fetched once even when that host disallows it, and never crawled on from;
- identify ourselves honestly in the User-Agent;
- keep a rate limit per host;
- never fetch a URL that a Caller supplies.

### Spec delivery
- The Published Form is returned by default, byte for byte.
- The Normalized Form (bundled, current OpenAPI, JSON) is returned on request.
- Validity Issues are reported and never block delivery.
- Spec content is never returned inline through MCP.

### Access
- Answers from the Index are open to anyone, with a rate limit per IP.
- Discovery and `fresh: true` need an API key with a daily quota.
- Keys are handed out manually in v1: stored hashed, created with an admin command. There are no user accounts.

## Surfaces

**HTTP API and MCP.** Both expose the same four operations:

| Operation | Returns |
|---|---|
| `lookup_api(name, apiVersion?, allowCommunity?, fresh?)` | The Outcome with metadata and download URLs |
| `list_vendor_apis(vendor)` | The Vendor's APIs, from the Index |
| `get_spec_outline(apiId)` | The Spec Outline |
| `get_operation(apiId, method, path)` | One operation with its schemas fully expanded |

**Web UI.** Built with shadcn primitives, with the visual language set by Impeccable (`PRODUCT.md` via `/impeccable init`). The screens:
- **Search.**
- **Lookup result,** with a distinct view for each Outcome.
- **Spec viewer:** embedded Scalar, with its "try it" client disabled, wrapped in our frame showing Provenance, `verifiedAt`, the Published/Normalized switch, Alternates, Validity Issues and downloads.
- **Index browsing:** Vendors → APIs.
- **API and MCP docs page,** plus a "request a key" link.

All Spec content is untrusted: rendered with sanitisation, under a strict Content Security Policy.

## Stack

One TanStack Start app (Router, Query, Table) running as a single instance on Coolify. SQLite through Drizzle in WAL mode, replicated to Backblaze B2 with Litestream (ADR 0002). Jev through the TypeSafe JS SDK, behind a narrow judgment interface. TypeScript throughout.

Explicitly **not** in v1: LangGraph, TanStack AI, OpenRouter, Perplexity, Browserbase/Stagehand, MongoDB, Express, AI-written summaries, user accounts, billing.

## Delivery slices

Each slice is usable end to end and demonstrable. Later slices don't start until the earlier slice's acceptance criteria hold.

### Slice 1 — Benchmark and core Lookup
- The Benchmark, stored as data, plus a runner that reports False Resolution rate, coverage and Outcome accuracy.
- `lookup_api` over HTTP, running Discovery through APIs.guru and a Developer Portal found by web search, then known-path checks.
- Jev judgments for: which API the name means; which Candidate or link is the Spec; whether the Spec describes the API.
- All five Outcomes, and Official vs non-Official Provenance.
- Specs stored in the Index (SQLite).
- **Accept when:** the runner reports False Resolution < 2% across the Benchmark.

### Slice 2 — Provenance and versions
- A shallow crawl of the Developer Portal, with link selection by Jev.
- GitHub code search.
- All four Provenance tiers; Community opt-in with `allowCommunity`.
- API Versions, Preview Versions, Current, Alternate and Superseded Specs.
- **Accept when:** False Resolution is still < 2% and long-tail coverage is ≥ 60%.

### Slice 3 — Live service
- Deployed on Coolify, with Litestream to Backblaze B2 and **a rehearsed restore**.
- Answers served from the Index; background Verification of Stale entries; `fresh: true`.
- API keys, quotas and per-IP rate limits.
- **Accept when:** answers from the Index hit p90 < 200 ms and Discovery hits p90 < 15 s in production, and a restore from B2 has been done.

### Slice 4 — Spec forms and navigation
- The Normalized Form, including Swagger 2 → OpenAPI conversion and bundling.
- Validity Issues.
- Download URLs for both forms.
- `get_spec_outline` and `get_operation`.
- `list_vendor_apis`.
- **Accept when:** these work on the largest Benchmark Specs (GitHub, Stripe) without timeouts.

### Slice 5 — MCP server
- The four tools over MCP, authenticated with an API key.
- **Accept when:** Claude Code, given only the MCP server, can find and call three operations of a Benchmark API it hasn't seen before.

### Slice 6 — Web UI
- `/impeccable init` → `PRODUCT.md`, then the screens listed above, built with `shape` → `craft` → `polish`.
- **Accept when:** `/impeccable audit` is clean, and the UI is keyboard-navigable and meets WCAG AA.

## Open questions (decide during the build)
- Which web search provider: Brave, Exa or Tavily.
- How long the freshness window is (7 days is the starting assumption).
- Quota sizes for API keys and per IP.
- Exact Jev thresholds, which come from Benchmark tuning.
- When to add human curation of the Index, and a scheduled sweep for APIs nobody looks up.

## Later (not v1)
- Self-service keys through GitHub sign-in, and paid tiers.
- Postman public network, SwaggerHub, and Browserbase as a fallback for Developer Portals that render in JavaScript.
- Escalation to a reasoning model on the server (TanStack AI), if Callers can't handle unresolved results.
- "Ask this Spec" chat, version comparison, a CLI.
