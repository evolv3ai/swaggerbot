# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, served equally (Wes, 2026-09-25):

- **The developer who needs a Spec now.** They have the name of an API and want the right OpenAPI or Swagger Spec, where it came from, and a download link, in seconds. The UI is a tool for them: Search, the Lookup result, the Spec viewer.
- **The evaluator.** A developer or platform lead deciding whether to wire swagger.bot into their agents (MCP) or programs (HTTP API). They judge whether its answers can be trusted, and leave with the setup: the endpoint, the `claude mcp add` command, how to get a key.

The same pages serve both: a working Lookup is also the best demonstration. People are the secondary Caller overall (PRD): agents over MCP and programs over HTTP are primary, so the Web UI is the public shop window and the Index browser, not the main way the service is used.

## Product Purpose

swagger.bot turns the name of an API into a verified Spec with its Provenance, or says honestly why it can't. It answers from a growing Index of verified Specs, and runs Discovery on the live web only when the Index can't answer (and only with an API key). Success is a Caller who builds on the right Spec, never on a hallucinated URL or a third-party copy passed off as the Vendor's.

## Positioning

**Precision over coverage.** Every answer is exactly one Outcome (Resolved, Ambiguous, Unconfirmed, No Spec, Unknown), and an honest Ambiguous or No Spec is always preferred to a False Resolution. Each Spec carries its Provenance (Official, Endorsed, Mirror, Community), its Sources and `verifiedAt`, so the Caller can see why to trust it. Directories such as APIs.guru list popular APIs; swagger.bot finds the long tail on the live web and says how sure it is.

## Operating Context

- Terminal and editor people: they arrive with a name, copy a URL or a `curl`, and leave. Many will reach the site from an agent's answer or a README.
- The HTTP API (`/api/…`) and the MCP endpoint (`/mcp`) are the product's working surfaces; the Web UI shows the same answers, from the same functions.
- Keys are handed out by hand (no accounts in v1): the UI's "request a key" is a `mailto:` link. The UI itself never holds a key, so it shows Index answers only; a name the Index doesn't know is answered with how to run Discovery with a key.

## Capabilities and Constraints

- Terms are the glossary's, exactly (`CONTEXT.md`): Vendor, API, Spec, Published Form, Normalized Form, Validity Issue, Spec Outline, API Version, Current Spec, Alternate Spec, Provenance and its tiers, Outcome names, Lookup, Discovery, Index.
- Screens (PRD, Slice 6): Search; the Lookup result, one view per Outcome; the Spec viewer (Scalar with "try it" disabled, in a frame showing Provenance, `verifiedAt`, the Published/Normalized switch, Alternates, Validity Issues and downloads); Index browsing, Vendors → APIs; the API and MCP docs page.
- **All Spec content is untrusted:** rendered sanitised, as text in our own frame, and inside a sandboxed frame under a strict Content Security Policy for Scalar. No Spec may run script, load remote content or call a server.
- Specs can be very large (Cloudflare's is 26 MB). Validity Issues never block a Spec from being shown or downloaded.
- Stack is fixed by the codebase: TanStack Start (React 19) on Nitro, one instance; Tailwind v4 and shadcn for the UI (`docs/slices/slice-6-backlog.md`, D3).
- Not in v1: accounts, billing, self-service keys, AI-written summaries, "ask this Spec" chat.

## Brand Commitments

- The name is shown as **SwaggerBot**, with its existing bot icon (`public/favicon.svg`; the `BotMark` drawing in `src/routes/index.tsx`, also on `public/og.png`). The domain is `swaggerbot.dev`; the project and its docs say `swagger.bot`. (Wes, 2026-09-25.)
- Nothing else from the interim landing page is binding: its colours and type are open to the new visual direction.
- Voice: plain and exact. Say what was found and how sure we are; say plainly when nothing was. Never oversell.

## Evidence on Hand

- **The Benchmark** (`benchmark/entries.json`): 40 labelled names: 12 popular, 12 long-tail, 10 ambiguous names or multi-API Vendors, 6 negatives. (The PRD plans about 150; it is 40 today.)
- **Latest results** (`docs/slices/slice-4-result.md`, 2026-09-23): False Resolution 0 of 20 Resolved answers, on two runs, after re-scoring with two labels Wes accepted (1/20 and 2/20 before). Discovery p90 13.7 s in production; Index answers p90 80 ms. Earlier runs: `slice-2-result.md`, `slice-3-result.md`.
- Any Benchmark figure the UI shows states its base (the 40-name Benchmark), the date of the run, and links to how it was measured; it is updated by hand after each run. Index counts (Vendors, APIs, Specs) are read live.
- There are no customers, testimonials, logos or press. None may be invented.

## Product Principles

1. **Precision over coverage.** When the answer isn't certain, the UI says so as clearly as it shows a Resolved one.
2. **Show the why.** Provenance, Sources and `verifiedAt` are next to every Spec, not behind a click.
3. **Get people to the artefact.** A download URL, a `curl`, an MCP call: the thing to copy is always one step away.
4. **Spec content is untrusted.** Nothing from a Spec is ever rendered as live HTML or allowed to reach the network.
5. **Same answers everywhere.** The UI shows what the HTTP API and MCP return, in the same words.

## Accessibility & Inclusion

WCAG 2.2 AA, and every screen fully usable by keyboard alone (the PRD's Slice 6 acceptance). Light and dark themes both meet it.
