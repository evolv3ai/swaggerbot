---
version: 1
slug: "src-routes-index-tsx"
primary_target: "src/routes/index.tsx"
related_targets: ["src/routes/__root.tsx"]
---

# Search (`/`) and the app shell

**Scope and mode:** the front door and the docs shell every screen inherits. Persuade (the evaluator) and Operate (the developer who needs a Spec now), equally (PRODUCT.md). Lookup result, Spec viewer, Index browsing and Docs extend it.

**Audience, job, proof:** a developer types the name of an API and leaves with the right Spec's download URL, its Provenance and `verifiedAt`; an evaluator sees that it works, how sure it is, and how to plug it into an agent. Proof is live: real Index answers, live counts, the Benchmark with its base (40 names) and date. Nothing invented.

**Chosen direction:** pinned by Wes on 2026-09-26: the SwaggerBot design system v2 (`docs/design/swaggerbot-design-system-v2/`) in a Mintlify-grade docs shell, dark by default; approved mock `docs/design/approved-mock/`. This replaces Darkroom Safelight (rejected by Wes after seeing it).

**Constraints:** WCAG 2.2 AA in both themes, keyboard-complete; Tailwind v4 + shadcn primitives restyled to the design system; fonts self-hosted (CSP `font-src 'self'`); no Spec content rendered as HTML; the UI holds no key; everything WTR-142/143 fixed stays fixed (underlined body links, honest 400/429 statuses, onward links, Sources on the viewer).

**Roll record:** seed `de69dacf`. Round 1 (assigned The Assay Office) re-rolled safer; round 2 Wes chose The Manual Page, then rejected its mock; round 3 (bolder, picture hand) re-rolled with the steer "Sleek docs", taken as the canon exit: Mintlify as the craft bar. Wes then supplied his own design system, which pins the world.

## Direction contract

THESIS: SwaggerBot is the best-looking docs site in a sea of docs: a Lookup is a docs page that answers. It refuses the product-landing hero and any themed costume; it is a docs site, just slightly more attractive than the rest.

OWN-WORLD: the design system v2: ink ground (dark default), white text, SwaggerBot Blue for the mark, primary actions and the active nav item; Montserrat 800 headings and the tracked BETTER THAN SPECS eyebrow; IBM Plex Sans body; JetBrains Mono for paths and code; 16px-radius cards with 1px edges, 2px blue outline for the one highlight per view; the five answers as coloured pill badges (Resolved green, Unconfirmed amber, Ambiguous blue, No Spec neutral, Unknown outline); the robot mark as the only personality.

STORY: the visitor recognises a docs site and trusts it; the search answers on the spot with the Spec, its Provenance and a one-click download; the sidebar shows the Index, the HTTP API and MCP as more pages of the same manual.

FIRST VIEWPORT: top bar: mark + SwaggerBot wordmark left, the ⌘K search (Lookup) centre, Vendors, GitHub, status dot and "Get an API key" right. Left sidebar groups: Get started, The Index, HTTP API, MCP. Main column: BETTER THAN SPECS eyebrow, "No fake Specs." (Montserrat 800), one-line lead, the Lookup box (2px blue outline, input + Look up, options, Try chips and "21 APIs answer without a key"), then "What you get back" (a real Resolved answer card with curl/MCP/JSON tabs) and the five answers. Right rail: On this page. Phone: top bar with menu, no rails.

FORM: pinned by Wes: SwaggerBot design system v2 in a Mintlify-grade docs shell (the canon exit, executed at full craft); seed key de69dacf (round 3 steer "Sleek docs").

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
