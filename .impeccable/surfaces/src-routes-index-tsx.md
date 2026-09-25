---
version: 1
slug: "src-routes-index-tsx"
primary_target: "src/routes/index.tsx"
related_targets: ["src/routes/__root.tsx"]
---

# Search (`/`) and the app shell

**Scope and mode:** the front door and the shell every screen inherits. Persuade (the evaluator) and Operate (the developer who needs a Spec now), equally (PRODUCT.md). This surface establishes the visual world; Lookup result, Spec viewer, Index browsing and Docs extend it.

**Audience, job, proof:** a developer types the name of an API and leaves with the right Spec's download URL, its Provenance and `verifiedAt`; an evaluator sees that it works, how sure it is, and how to plug it into an agent. Proof is live: real Lookups from the Index, live Index counts, and the Benchmark figures with their base (40 names) and run date. Nothing invented.

**Chosen direction:** Darkroom Safelight, picked by Wes on 2026-09-25 from the bolder-register hand (round 3, after two re-rolls).

**Constraints:** WCAG 2.2 AA in both themes, keyboard-complete; Tailwind v4 + shadcn primitives restyled into the world; no Spec content rendered as HTML; the UI holds no key (Index answers only); the SwaggerBot name and bot icon are binding (the icon's drawing is kept; its tile colour follows this world).

**Unresolved:** the exact faces (grease-pencil display, condensed instrument caps, numerals) are chosen at build; the Search headline's words are drafted at build and shown to Wes.

## Direction contract

THESIS: A Spec is developed, not fetched. The page is a working darkroom where a typed name becomes a fixed print with its Provenance on the back. It refuses the category default: a centred search box beside a code sample over a route table.

OWN-WORLD: The light theme is the lit bay: safelight amber (#FFB000 to #E2A352) owns every region, with dense-black ink and deeproom-brown rules. The dark theme is the bay with the light off: deeproom brown and dense black, amber as the ink. The only tonal ladder is the silver test strip (enamel white → silver → darkroom grey → dense black), used for certainty and freshness. Enamel white is reserved for prints (Spec cards). Grease-pencil display is for one to three human words; condensed instrument caps are for labels; seven-segment numerals are for counts, times and sizes. Controls are bordered tray-edge buttons: amber-filled primary, black secondary. The raises: recency as density (the newest verification is the darkest print; Stale prints read washed); scale mapped to certainty (Resolved lands large, Unconfirmed and Ambiguous smaller and quieter); batch numerals (every print carries its Spec id and `verifiedAt` as monospaced batch marks).

STORY: The visitor sees the darkroom working before they touch it. They write a name on the test strip and watch the answer develop through the real Source chain, then take the fixed print away: the download URL, its Provenance and `verifiedAt`. The evaluator reads the drying line (live Index counts, the dated Benchmark) and copies the one line that adds the MCP server.

FIRST VIEWPORT: Desktop: a left rail holds the SwaggerBot mark and wordmark, the nav as labelled drawers, and a "last print" panel (the most recent real verification: API, Provenance, `verifiedAt`). The main field sets a grease-pencil headline at top-left, about a third of the width. Below it sit the search line (a test-strip-labelled input) and the amber "Develop" button. Across the lower band, the six numbered stations of the real Source chain (Index · APIs.guru · Developer Portal · Vendor domain · GitHub · Verified), the active one lit. A safelight status bar carries live counts and the Benchmark with its date. Mobile: the rail becomes a top bar and the stations a two-column grid, with no horizontal scroll. Signature interaction: attract mode. On idle it replays real Index Lookups developing through the stations, labelled as a replay; it is static under reduced motion. A submitted Lookup develops the same way, then lands on /lookup.

FORM: Darkroom safelight bay (catalog `signals-instruments-darkroom-safelight-bay`), the bolder register's dealt leader, chosen over Sneaker Box Stacks and Window-Box Toy Shelf. Seed key d05b4106 (round 3, `--reroll 2 --register bolder`).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
