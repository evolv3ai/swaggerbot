# Slice 6 backlog: Web UI

**Status: approved by Wes, 2026-09-25** (D1–D8 as recommended; D9 a `mailto:` to hello@evolv3.ai). Filed on Linear as in the Order table. Unkey for keys was considered the same day and deferred to self-service keys (PRD "Later"): see D9.

The issues for [Slice 6](../PRD.md#slice-6--web-ui), written so the weawr factory can build them: each numbered body is filed as-is on Linear (team WTR, labels `ai` + `swaggerbot`). Capitalised terms are from [`CONTEXT.md`](../../CONTEXT.md). Conventions shared by every issue live in `.weawr/instructions.md`.

**Acceptance (PRD):** `/impeccable audit` is clean, and the UI is keyboard-navigable and meets WCAG AA. Proposed concretely (D8):
- **Impeccable:** `audit` reports no P0 or P1 findings, and no dimension scores below 3 of 4 (Accessibility 4). `npx impeccable detect` reports nothing, or only findings that are written down as false positives with a reason.
- **WCAG AA:** `scripts/uicheck.ts` (issue #1) runs axe-core (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`) on every screen at 390 and 1280 wide, in light and in dark, and finds no violations.
- **Keyboard:** the same script tabs through each screen and checks that every interactive element is reached, has a visible focus ring and isn't trapped. The operator also walks every screen by keyboard alone once (O4).
- **Nothing costs what Slices 3–5 bought:** `formscheck` and `mcpcheck` still pass on production, and the HTTP API answers as before.

## Where it stands going in

Slice 5 is accepted (production `f6b9bf3`, `main` `2299aef`). The UI has these pieces to start from:
- **`/`** is the interim landing page (`src/routes/index.tsx`, 338 lines, with `src/styles/site.css`, 442 lines, from #81 and #86). It is static: its Lookup is a sample, not a form. Slice 6 replaces it.
- **No shadcn, no Tailwind** in the repo. Scalar is present only as a parser (`@scalar/openapi-parser`, `@scalar/json-magic`). There is no API reference component.
- **No security headers.** No response sets a Content Security Policy, `X-Frame-Options` or `frame-ancestors`.
- **The HTTP API the screens read is all live:** `POST /api/lookup`, `GET /api/specs/{specId}/published` and `/normalized`, `GET /api/apis/{apiId}/outline|operation|schema`, `GET /api/vendors/{vendor}/apis`, `GET /api/health`.
- **No route lists the Vendors.** `/api/vendors/{vendor}/apis` answers one Vendor. The Index is small (20 Vendors at Slice 3, a few dozen now), but it grows with every Lookup.
- **Impeccable isn't installed** for Claude Code, on this machine or in the repo. Upstream is [`pbakaus/impeccable`](https://github.com/pbakaus/impeccable) (Apache-2.0, plugin 4.4.0, active). It installs per project with `npx impeccable install --providers=claude --scope=project`. It is one skill with sub-commands (`init`, `shape`, `craft`, `polish`, `audit`, …), a deterministic detector (`npx impeccable detect`, no LLM), and optional Claude Code hooks (SessionStart, PostToolUse on Edit/Write, Stop) that run its detector.
- `docs/swagger.bot-uxui-spec.md` is superseded. The landing page took its colours and type; Slice 6 takes neither for granted.

## Decisions

- **D1. Impeccable: install it in the repo, pinned.** *Taken; done 2026-09-25:* skill 4.3.1 (engine 0.1.5) with its four agents, in `.claude/skills/impeccable/` and `.claude/agents/`, installed with `--no-hooks`. The engine binary is git-ignored; the launcher downloads it to `~/.impeccable/bin/` on first use. Update it with `npx impeccable update` as a deliberate commit. *As recommended:* the operator runs `npx impeccable install --providers=claude --scope=project` in swagger.bot, checks what it wrote, and commits the skill (pinned at the version installed) so every factory worktree has it. **Hooks off in the repo:** the detector runs where we choose (issue Done-when lists, `uicheck`, and O3), not on every edit a factory agent makes, so a PR's diff and timing stay predictable. The alternative is a global install on this machine only, with the factory building from `PRODUCT.md` and `DESIGN.md` alone; that's simpler but factory agents couldn't run `craft` against the design.
- **D2. Who does what: Impeccable's interactive steps are operator work.** `init` interviews the product owner (who uses it, what it's for, constraints), and the visual direction (`DESIGN.md`, through `shape`) is a design decision. *Recommended:* O1 is a session with Wes that produces `PRODUCT.md`, `DESIGN.md` and a short shape brief for each of the five screens, committed under `docs/design/`. The factory issues then build screens against those files with `/impeccable craft`. `polish` and `audit` are operator passes (O3), whose fixes go out as small PRs. *Amended by Wes, 2026-09-25, after `init`:* Impeccable writes `DESIGN.md` at the end of the first build, from what was built, not before it. So O1 is the direction round with Wes, then the operator builds the shell and Search through Impeccable (its finish review, then its documenter writes `DESIGN.md` and `.impeccable/design.json`). The other screens are extensions of that world, built by the factory against `DESIGN.md`. Issue #1 is narrowed to plumbing, and Search moves from #3 into O1.
- **D3. Styling: Tailwind v4 + shadcn, as the PRD says.** *Recommended:* Tailwind 4 through its Vite plugin, and `shadcn` (the CLI, current 4.x) with components copied into `src/components/ui/`, so we own them and they carry Radix's keyboard and ARIA behaviour. Theme tokens (colour, type, radius, spacing) come from `DESIGN.md`, as CSS variables for light and dark. `site.css` stays for `/` until O1's Search replaces the page, and is then deleted. The alternative is plain CSS with Radix primitives; it's leaner, but it drops the PRD's shadcn and the factory's familiarity with it.
- **D4. Rendering: server-rendered pages that read the Index directly.** *Recommended:* each screen is a TanStack Start route whose loader calls a server function over the same answer functions the HTTP API uses (`answerVendorApis`, the Lookup core, `pageOutline`, …), not a `fetch` to our own `/api/…`. Pages render on the server, so the first paint has the content, and links are real links, which is good for the keyboard and for a crawler. Client JavaScript is for the search form, the Published/Normalized switch and the Spec viewer.
- **D5. Search and Lookup: the UI answers from the Index only.** The UI has no API key, and Discovery needs one (Slice 3). *Recommended:* the search form sends a Lookup with no key. An Index answer shows the Lookup result. A name the Index doesn't know shows its own view, "Not in the Index yet", with the `curl` or MCP call that runs Discovery with a key, and the "request a key" link (D9). No key is ever stored in the browser, and there is no `fresh`. Rate limits apply per IP as for any Caller. *Found in WTR-138's verification (2026-09-25):* the Index can only answer Resolved (`answerFromIndex` returns a Resolved Outcome or nothing), so without a key the Ambiguous, Unconfirmed, NoSpec and Unknown views can't appear on `/lookup`. *Wes, 2026-09-25:* keep those views (they're tested with a fake app) for a later path that uses a key; their screenshots aren't part of Slice 6's acceptance.
- **D6. Spec viewer: Scalar in a sandboxed frame, under its own CSP.** Spec content is untrusted (PRD): descriptions carry Markdown and HTML, and a Spec names servers. *Recommended:*
  - `@scalar/api-reference` (1.72.x), self-hosted from our build, not from a CDN.
  - It renders on its own route, `/embed/specs/{specId}?form=published|normalized`, a standalone HTML document outside the app shell.
  - That route is framed by the viewer page with `<iframe sandbox="allow-scripts">` (no `allow-same-origin`, so the frame has an opaque origin and can't touch the app), and is served with `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src <the Spec's own download URL only>; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`. So a Spec can't run script, load remote images (tracking pixels), or call any server, even if Scalar's own sanitiser misses something.
  - Scalar's options: `hideTestRequestButton`, `hideClientButton`, `telemetry: false`, `withDefaultFonts: false`, `agent` and `mcp` off, `proxyUrl` unset. "Try it" is off twice: by option and by CSP.
  - Our frame around it (on the app page, not in the iframe) shows Provenance, `verifiedAt`, the Published/Normalized switch, Alternate Specs, Validity Issues and the downloads. It never renders Spec text as HTML: every string from a Spec is text.
  - Large Specs: Cloudflare is 26 MB. The viewer loads Scalar only for the chosen form, shows its size first, and for Specs over 10 MB links to the outline and downloads instead of rendering them inline (the threshold is checked in the issue's manual check against Stripe, GitHub and Cloudflare).
- **D7. Index browsing: a new `GET /api/vendors`.** *Recommended:* `GET /api/vendors?cursor=&limit=&query=`: Vendors ordered by name, each with its id, name and API count, 50 per page by default (at most 200), `query` a substring of the id or name. The `/vendors` page uses the same function. **No new MCP tool:** `tools/list` is 28.4 kB, near `mcpcheck`'s 30 kB bound, and an agent reaches Vendors through `lookup_api` and `list_vendor_apis`. The open follow-up that `list_vendor_apis` needs paging past ~20 APIs is left open (not Slice 6).
- **D8. Acceptance:** as at the top. The WCAG AA check is automated (`uicheck`) so every screen issue can run it in its PR, not only at the end. `uicheck` uses Playwright (`playwright` and `@axe-core/playwright` as dev dependencies, Chromium only). The alternative is the headless-Chrome screenshots of earlier slices plus a manual axe run, which catches less and can't run in a PR.
- **D9. "Request a key": a `mailto:`.** *Taken (Wes, 2026-09-25):* a `mailto:` link with a prefilled subject ("swagger.bot API key request"); to **hello@evolv3.ai** (Wes, 2026-09-25). Keys stay hand-issued in the Index (`scripts/keys.ts`). **Unkey was considered and deferred:** it maps cleanly onto our keys (daily credits refilled at midnight UTC, `verifyKey` codes; our `findKey`/`takeQuota` seam makes it one adapter issue, with `findKey` going async), but it puts an outside service in the auth path and its customer portal, the part that would replace this link, is unreleased. Revisit with self-service keys.

## Screens and routes

| Screen | Route | Reads |
|---|---|---|
| Search | `/` | nothing until submitted; Lookup (Index only) |
| Lookup result | `/lookup?name=…[&apiVersion=…][&allowCommunity=1]` | the Lookup core; one view per Outcome |
| Spec viewer | `/specs/{specId}[?form=normalized]`, framing `/embed/specs/{specId}` | the Spec's forms, Provenance, Alternates, Validity Issues |
| Index browsing | `/vendors`, `/vendors/{vendorId}` | `GET /api/vendors`'s function; `answerVendorApis` |
| Docs | `/docs` | static: the HTTP API, MCP, key rules, "request a key" |

The shell (header with the five destinations, footer with health, the skip link) wraps every route except `/embed/…`.

## Order

| # | Linear | Issue | Depends on | Wave |
|---|---|---|---|---|
| 1 | WTR-136 | The UI plumbing: Tailwind, shadcn, security headers, `uicheck` | — | 1 |
| 2 | WTR-137 | `GET /api/vendors`: the Vendor list, paged | — | 1 |
| 3 | WTR-138 | The Lookup result | 1, O1 | 2 |
| 4 | WTR-139 | The Spec viewer: Scalar, sandboxed, in our frame | 1, O1 | 2 |
| 5 | WTR-140 | Index browsing: Vendors → APIs | 1, 2, O1 | 2 |
| 6 | WTR-141 | The docs page and "request a key"; the landing page's content retired | 1, 3, O1 | 3 |

Wave 1: WTR-137 (#2) was queued on filing, and WTR-136 (#1) on 2026-09-25 once it was narrowed; neither needs the design. Wave 2 is queued when #1 and O1's PR have merged; later waves wait in Backlog with `swaggerbot` only. Each wave-2 issue adds one route file and one line to the nav list the shell defines (O1), a mechanical conflict: wave 2 is merged one PR at a time, merging `main` into each, as in Slice 5.

## Operator steps (not factory issues)

- **O1. Impeccable, the direction and the first surface, with Wes** (D1, D2 as amended). Done: install (D1), `/impeccable init` → `PRODUCT.md` (Wes's answers). Then: the direction round on Impeccable's decision page (Wes picks, steers or re-rolls); the direction contract in the Search surface brief (`.impeccable/surfaces/src-routes-index-tsx.md`); the operator builds, code-led (no image generation here), on top of #1's plumbing: the shell (`src/components/shell/`: header with the SwaggerBot mark and the nav list in `nav.ts`, a footer with `/api/health`, the skip link, `<main id="content">`, rendered by `__root.tsx` around every route except `/embed/…`) and **Search at `/`**, replacing the landing page (a labelled field for the name of an API, optional API Version, "Include Community Specs", a GET to `/lookup`; `site.css` deleted). Then Impeccable's finish review, and its documenter writes `DESIGN.md` and `.impeccable/design.json`. One PR, verified with `uicheck` and `impeccable detect`, merged before wave 2.
- **O2. Deploy after each wave**, keeping `docs/deploy.md` current, with `mcpcheck` and `formscheck` after each. After wave 2, headless screenshots of every screen on production.
- **O3. Polish and audit.** `/impeccable polish` and `/impeccable audit` over the whole UI once wave 3 is merged. Fixes go out as small PRs (by the operator, or filed for the factory if they're more than a few lines).
- **O4. Acceptance** (D8), recorded in `docs/slices/slice-6-result.md`: the audit's scores and findings, `uicheck`'s output, `npx impeccable detect`'s output, a keyboard walk of every screen, and screenshots at 390 and 1280 in light and dark. Then Wes looks at it.

---

## 1. swaggerbot: the UI plumbing: Tailwind, shadcn, security headers and `uicheck`

## Problem
Slice 6 builds five screens (PRD "Surfaces → Web UI"). They need one styling system, security headers on every page, and a way to check each screen for WCAG AA and keyboard use in its own PR. The look is set later, by the operator's first surface (backlog O1), which writes `DESIGN.md`; this issue is the plumbing under it and sets no visual design.

## Change
- **Styling:** add `tailwindcss` 4 and `@tailwindcss/vite`, and set up `shadcn` (the CLI's `init` for Vite + React, components under `src/components/ui/`, the `cn` helper under `src/lib/`). Theme tokens as CSS variables in `src/styles/app.css`, light and dark (`prefers-color-scheme`), with shadcn's neutral defaults as placeholders: O1 replaces their values. Add no components yet. The existing landing page (`src/routes/index.tsx` with `site.css`) must look exactly as it does today: keep Tailwind's preflight from changing it (for example by loading `app.css` only where it's used, or checking the page's screenshots before and after).
- **Security headers on every HTML response** (a Nitro plugin or middleware in `src/server/`): `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. If TanStack Start's hydration needs an inline script, use a per-request nonce, not `'unsafe-inline'`. The landing page loads Google Fonts today: self-host those two faces (Inter, JetBrains Mono) under `public/fonts/` so the page still renders the same under this policy. `/api/…`, `/mcp` and downloads keep their current headers. `/embed/…` will get its own policy (issue #4).
- **`scripts/uicheck.ts <baseUrl> [--routes /,/docs,…] [--json] [--out dir]`** (`playwright` and `@axe-core/playwright`, dev dependencies, Chromium only): for each route, at 390 and 1280 wide and in light and dark, run axe with the tags `wcag2a wcag2aa wcag21aa wcag22aa` and fail on any violation; then press Tab until focus returns to the start, and fail if an interactive element is never reached, if focus is trapped, or if a focused element has no visible focus indicator (its outline or box-shadow is unchanged from unfocused). Also fail on any CSP violation in the console. Save a screenshot of each run under `--out` (default `uicheck-out/`, git-ignored). Exit 1 on any failure.

## Done when
- Tests: the header plugin sets the CSP on an HTML response and not on `/api/health`; `uicheck`'s pass/fail logic on a small fixture page (a missing label, a focus trap).
- `pnpm check` and `pnpm build` green; `uicheck --help`.
- The manual check in the PR: `uicheck` against the built server on `/`, output pasted (a violation it finds on today's landing page is reported, not fixed: list it in the PR), and screenshots of `/` at 390 and 1280 before and after this change, which must match. The page loads with no CSP violation in the console.

## 2. swaggerbot: `GET /api/vendors`, the Vendor list, paged

## Problem
Index browsing (Vendors → APIs) needs the list of Vendors, and only `GET /api/vendors/{vendor}/apis` exists, which answers one Vendor.

## Change
- Shared, in `src/server/vendors.ts`: `listVendors(db, { query?, cursor?, limit? })` → `{ vendors: { id, name, apiCount }[], total, nextCursor }`. Ordered by name, then id, ignoring case. `query` is a substring of the id or name, ignoring case. `limit` defaults to 50, at most 200. `cursor` is opaque (an offset is fine). Only Vendors with at least one API in the Index are listed.
- HTTP `GET /api/vendors` (open, per-IP limit, as the other `/api/…` reads), a JSON 400 for a bad `limit` or `cursor`.
- Add it to the README's route table (not the landing page, which issue #3 removes; issue #6's docs page lists it).
- No MCP tool (backlog D7).

## Done when
- Tests: ordering, `query`, paging across the end, a bad cursor, the per-IP limit applies; the route is listed in the README.
- `pnpm check` and `pnpm build` green.
- The manual check in the PR: `curl` `/api/vendors` and `/api/vendors?query=str` on the built server with a copy of an Index, output pasted.

## 3. swaggerbot: the Lookup result

## Problem
Search (`/`, built in backlog O1) submits a name to `/lookup`, which doesn't exist. The PRD's Lookup result has a distinct view for each Outcome. Design: `DESIGN.md` and `PRODUCT.md`; build it as an extension of the shell and Search, in their components and tokens (Impeccable: `.claude/skills/impeccable/`, an extension inside an established world).

## Change
- **`/lookup?name=…[&apiVersion=…][&allowCommunity=1]`**: a server function runs the Lookup core **with no key** (backlog D5), so only Index answers resolve. The Search form sends `apiVersion` even when it's blank: a blank `apiVersion` means none. Reuse the darkroom components O1 built (`src/components/darkroom/`: the print, Provenance mark, verified stamp, certainty strip, stations) rather than new ones; the Outcome's density on the certainty strip is its visual weight. One view per Outcome, each with a heading that names the Outcome:
  - **Resolved:** the API, its Vendor, the Current Spec's Provenance and `verifiedAt`, the two download links, Alternate Specs, and a link to the Spec viewer (`/specs/{specId}`).
  - **Ambiguous:** the candidate APIs, each a link that retries the Lookup with that name.
  - **Unconfirmed**, **NoSpec** and **Unknown** (`src/domain/outcome.ts`): what was found, or why nothing was, in the Outcome's own words and fields.
  - **Not in the Index** (Discovery needs a key): says so plainly, shows the `curl` and the MCP call that would run Discovery with a key, and links to `/docs#keys`.
  - A rate-limited request shows when to retry.
- The nav is unchanged (Search is already there).

## Done when
- Tests: the server function for each Outcome (fake Index), that no key is ever sent, and that `name` is required.
- `pnpm check` and `pnpm build` green; `uicheck` passes on `/lookup` for each Outcome that the Index copy can produce.
- The manual check in the PR, on a copy of an Index: Stripe (Resolved) and a name it doesn't know (an Ambiguous answer can't come from the Index; see D5), each screenshotted at 390 and 1280.

## 4. swaggerbot: the Spec viewer: Scalar, sandboxed, in our frame

## Problem
A person who has found a Spec wants to read it. The PRD's Spec viewer embeds Scalar with "try it" disabled, inside our frame, and all Spec content is untrusted: it must not be able to run script, load remote content or call any server. Design: `DESIGN.md` and `PRODUCT.md`; build it as an extension of the shell and Search, in their components and tokens. The decision is backlog D6.

## Change
- Add `@scalar/api-reference` (1.72.x). Its browser bundle is served from our own build.
- **`/embed/specs/{specId}?form=published|normalized`**: a standalone HTML document (no app shell) that loads Scalar and points it at that Spec's download URL (`/api/specs/{specId}/published` or `/normalized`) with `hideTestRequestButton: true`, `hideClientButton: true`, `telemetry: false`, `withDefaultFonts: false`, `agent`/`mcp` off and no `proxyUrl`. Served with the CSP in backlog D6 (`connect-src` is the one download URL). The two download routes answer this frame's opaque-origin `fetch` (`Access-Control-Allow-Origin: *` on those two GET routes; they're public already).
- **`/specs/{specId}[?form=normalized]`**: in the shell. A frame showing the API and Vendor, Provenance, `verifiedAt`, the Published/Normalized switch (links, so it works without script), Alternate Specs (links to their viewers), Validity Issues (as text, count first, collapsible), and both downloads with their sizes. Below it, `<iframe sandbox="allow-scripts" title="API reference for …" src="/embed/specs/…">`. A pending Normalized Form says it's being built and to reload; a failed one says why.
- **Large Specs:** above 10 MB for the chosen form, don't load the iframe; say the Spec is too large to view here and link to the downloads and the outline (`/api/apis/{apiId}/outline`). Check the threshold in the manual check and say in the PR if 10 MB is wrong.
- Every string from a Spec (titles, descriptions, Validity Issue messages) is rendered as text by React in our frame, never as HTML.
- The nav is unchanged: the viewer is reached from a Lookup result or a Vendor's APIs.

## Done when
- Tests: the embed route's CSP header, exactly; the iframe's `sandbox` attribute; the size threshold; a Spec whose `info.description` holds `<script>`, `<img src=https://…>` and `javascript:` links renders none of them live (a Playwright test on a fixture Spec served by a local server: no request leaves `localhost`, no script runs).
- `pnpm check` and `pnpm build` green; `uicheck` passes on `/specs/{id}` for Stripe (the iframe's content is Scalar's and is checked by O3, not `uicheck`).
- The manual check in the PR, on a copy of an Index: the viewer for Stripe, GitHub and Cloudflare (time to interactive for each, or the too-large message), both forms, screenshots at 390 and 1280, and the browser's network log showing no request outside our origin.

## 5. swaggerbot: Index browsing: Vendors → APIs

## Problem
A person can't see what the Index already holds. The PRD's Index browsing screen lists Vendors, then a Vendor's APIs. Design: `DESIGN.md` and `PRODUCT.md`; build it as an extension of the shell and Search, in their components and tokens.

## Change
- **`/vendors[?query=…&cursor=…]`**: a server function over `listVendors` (issue #2): a filter field (GET form), the Vendors with their API counts as links, and "Next page" / "Previous page" links.
- **`/vendors/{vendorId}`**: a server function over `answerVendorApis`: the Vendor and its APIs, each with its Current Spec's Provenance, `verifiedAt` and a link to the Spec viewer; an API with no Current Spec says so. A 300 lists the matching Vendors as links; a 404 says the Vendor isn't in the Index and links to Search.
- Add "Vendors" to the nav (`src/components/shell/nav.ts`).

## Done when
- Tests: both server functions (fake Index), paging, the 300 and 404 views.
- `pnpm check` and `pnpm build` green; `uicheck` passes on `/vendors`, `/vendors?query=…` and `/vendors/stripe.com`.
- The manual check in the PR, on a copy of an Index: screenshots of the list and of two Vendors at 390 and 1280.

## 6. swaggerbot: the docs page, "request a key", and the landing page's content retired

## Problem
The PRD's API and MCP docs page, with the "request a key" link, doesn't exist; the interim landing page carried the route table and the Claude Code block, and O1 has replaced it with Search. Design: `DESIGN.md` and `PRODUCT.md`; build it as an extension of the shell and Search, in their components and tokens.

## Change
- **`/docs`**: the HTTP API (each route, `GET /api/vendors` included, with a `curl` example and its answer, the route table), MCP (the endpoint, the `claude mcp add` command, the five tools, result sizes), the key rules (a key is optional for Index answers; Discovery and `fresh` need one; quotas and the per-IP limit), and a **Keys** section (`#keys`) with the "request a key" link: `mailto:hello@evolv3.ai?subject=swagger.bot%20API%20key%20request` (backlog D9). Each code block has a Copy button that works by keyboard and says it copied (`aria-live`). Reuse the darkroom's `CodeLine` (`src/components/darkroom/code-line.tsx`, from WTR-138) rather than a new copy button.
- Add "Docs" to the nav. The README links to `/docs`.
- The route table and Claude Code block exist only here now: remove any copy left from the landing page.

## Done when
- `pnpm check` and `pnpm build` green; `uicheck` passes on `/docs`.
- Every `curl` on the page runs against the built server on a copy of an Index and answers as the page says (paste the runs in the PR).
- The manual check in the PR: screenshots at 390 and 1280, light and dark.

---

# O3 fixes: from Impeccable's critique (2026-09-25)

`/impeccable critique` of the whole UI scored **25/40** (snapshot `.impeccable/critique/2026-09-26T02-26-58Z__src-routes.md`). Wes chose to fix every P1 and P2 plus the minor findings, to guide keyless visitors with suggestions and a near-match, and to keep "Develop". Every item below is an extension inside the established world: follow `DESIGN.md` and `PRODUCT.md`, reuse `src/components/darkroom/`, add no dependencies, and don't change the direction (Darkroom Safelight). Each PR's Done-when includes `pnpm check`, `pnpm build`, `uicheck` on every route it touches at 390 and 1280 in light and dark, `impeccable detect --json` on the changed files (no new non-advisory findings), and screenshots in the PR.

Linear: #7 WTR-142, #8 WTR-143, #9 WTR-144, #10 WTR-145. Order: #7 and #8 together (their files barely overlap; merge one, then merge `main` into the other), then #9, then #10.

## 7. swaggerbot: harden the UI: links look like links, honest statuses, the Spec viewer links onward

## Problem
The critique's P1 #1 and P2 #5, plus status and live-region defects. The base `a` rule (`src/styles/app.css:158`) sets underline offset and thickness but never `text-decoration-line`, so any link without an `underline` class is plain text in the same colour (WCAG 1.4.1): the Spec viewer's "Published Form (YAML)" / "Normalized Form (JSON)" downloads (`src/routes/specs/$specId.tsx:140,148`), its Alternates (`:345`) and frame-note links (`:280,292`), "How it was measured" and "Read the docs" (`src/routes/index.tsx:513,522`), "Source on GitHub" (`src/components/shell/shell.tsx:209`). The Spec viewer shows no Sources (PRODUCT.md: Sources sit next to every Spec) and no way to its Vendor or Lookup. Error views answer HTTP 200. The health lamp announces twice on every page load.

## Change
- **Links:** underline every `a` in the base layer (`text-decoration-line: underline`); opt out, by class, only nav drawer items, the bot-mark home link, the skip link and links styled as buttons. Check every link on every route is either underlined or a visibly button-shaped control.
- **Statuses** (from the route's server function, with `setResponseStatus` from `@tanstack/react-start/server`): the rate-limited `/lookup` view answers **429** with `Retry-After` (seconds, as the API does); name-required answers **400**. "Not in the Index yet" and Resolved stay 200. `/vendors?cursor=<bad>` ("No such page") answers **400**.
- **Spec viewer** (`src/routes/specs/$specId.tsx`, `src/server/spec-page.ts`): the label shows the Current Spec's Sources (each Source URL with its Provenance and when it was last verified, as the Lookup result's Sources section does; reuse that component). The eyebrow's Vendor becomes a link to `/vendors/{vendorId}`, and add "Look it up" linking to `/lookup?name=<the API's name>`.
- **Links between objects:** the replay prints on Search (`src/routes/index.tsx` ~469) and the rail's "Last verified" (`shell.tsx:154`) link to `/lookup?name=<API name>`.
- **Search where it's needed:** the name-required, Unknown and "Not in the Index yet" views embed the Search form (the same component as `/`, prefilled with the name when there is one) instead of only "Look up another API"; the name-required view's link text no longer says "another".
- **Health lamp** (`src/components/shell/health-lamp.tsx:17`): the `aria-live` region announces only a change after first render (not "Checking the service" then "The service is up" on every load); a down service is still announced.

## Done when
- The shared checks above, on `/`, `/lookup?name=stripe`, `/lookup?name=`, `/lookup?name=frobnicator-xyz`, `/vendors`, `/vendors/stripe.com`, `/specs/{Stripe's specId}`, `/docs`.
- Tests: the statuses (429 with `Retry-After`, 400 name-required, 400 bad cursor, 200 Resolved and not-in-index); the Spec viewer's Sources and links; a computed-style check (Playwright, in `uicheck` or its own test that skips without Chromium) that every `a` in `main` has `text-decoration-line: underline` unless it carries the opt-out class.
- PR lists each link that was plain text and is now underlined.

## 8. swaggerbot: polish the Darkroom: the dark certainty strip, one Vendor name, the type ramp

## Problem
The critique's P2 #4 and the minor findings. In dark, Resolved (`#0e0e0e`) and the empty Unknown cell (`#140b03` bay) are ~1.1:1, so the certainty strip's two ends look the same (`src/components/darkroom/certainty-strip.tsx:14`), and the Resolved test patch beside the heading (`src/components/lookup/views.tsx:85`) is only an outline. Every Vendor's name equals its domain, so it shows two or three times (`vendor-apis.tsx:265-281`, `vendor-list.tsx:193-196`, "stripe.com (stripe.com)" at `views.tsx:868`). The detector found `text-[0.7rem]` (`certainty-strip.tsx:54`) off DESIGN.md's type ramp and a ~91-character measure on `/docs` (`docs-view.tsx:138`, `max-w-[40rem]`). The Develop press animates `border-width` (`index.tsx:115`, `docs-view.tsx:348`), which triggers layout. The Spec viewer's form switch uses `strip-5` as a generic active colour (`specs/$specId.tsx:241`), against the One Ladder rule.

## Change
- **Certainty strip, both themes:** the Unknown (empty) cell is drawn as empty **and** distinct from Resolved in both themes: a hatched or dashed fill in the rule colour, or the strip set on an enamel (`print`) backing in dark, your pick within DESIGN.md; every swatch pair that must differ reaches at least 3:1 against its neighbour or carries a visible pattern. The Resolved test patch is a solid, visible swatch in dark. Update DESIGN.md's certainty-strip entry to what you built.
- **One Vendor name:** show a Vendor's domain only when it differs from its name (`vendor-apis.tsx`, `vendor-list.tsx`, `views.tsx` VendorName). Keep the Vendor id in the page's data where a link needs it.
- **Type ramp:** replace `text-[0.7rem]` with the ramp's `label-sm` (0.75rem); keep the strip labels from wrapping at 390 (abbreviate with the full word in `aria-label`/`title` if needed).
- **Measure:** `/docs` prose at DESIGN.md's ~34rem; forms stay at 40rem.
- **Press:** the tray-edge press animates `transform` (and `box-shadow` if needed), not `border-width`, and looks the same.
- **Form switch:** the Published/Normalized switch's active state uses the black secondary (`ink` / `#0e0e0e` as the buttons do), not a strip token; if that's the same value, name it through the button token so the One Ladder rule holds in code.
- Advisory detector finding at `certainty-strip.tsx:54` gone.

## Done when
- The shared checks above, on `/`, `/lookup?name=stripe`, `/vendors`, `/vendors/stripe.com`, `/specs/{Stripe's specId}`, `/docs`, with the dark-theme screenshots of the strip in the PR and the contrast ratios measured for each adjacent swatch pair in both themes.
- Tests: the Vendor name/domain rule (equal → once; different → both).

## 9. swaggerbot: the Resolved page leads with the Spec: actions on the print, no repeats

## Problem
The critique's P1 #3. On a Resolved Lookup the print (`src/components/darkroom/print.tsx`, used in `views.tsx`) carries the Spec's facts but no actions; "The Current Spec" list repeats Vendor, Provenance, Verified and Spec; "Open in the Spec viewer" and the downloads sit ~1,400px down at 390. Six stations follow every Index answer, five saying "Not needed".

## Change
- The Resolved print's label carries the actions: **Open in the Spec viewer** (primary, `/specs/{specId}`), **Download** (Published Form, with format and size) and **Copy URL** (the Published Form's absolute download URL, with the darkroom `CodeLine` copy behaviour: keyboard-operable, announced via `aria-live`). The Normalized Form download stays in the list below.
- "The Current Spec" keeps only what the print doesn't show (API id, API Version, Spec format/version, Validity Issues, the Normalized Form); no row repeats a print fact.
- "How it was answered": when the Index answered, show one line ("Answered from the Index in N ms, no later station needed") with a disclosure (`<details>`) that opens the six stations; when a later station answered (a keyed Lookup), show them all as now.
- At 390, the viewer link and the Download are within the first screen (≤ 844px) of a Resolved page.

## Done when
- The shared checks above, on `/lookup?name=stripe`, `/lookup?name=github` and one Stale answer if the Index copy has one.
- Tests: the Resolved view renders the three actions with the right URLs; no fact appears both on the print and in the list; the stations collapse for an Index answer and don't for a later station.
- A measured position (Playwright): the top of "Open in the Spec viewer" at 390 is ≤ 844px.

## 10. swaggerbot: guide keyless visitors to what the Index holds

## Problem
The critique's P1 #2. With a few dozen APIs in the Index, most typed names land on "Not in the Index yet", which needs a key obtained by email. Nothing tells a visitor what does answer without a key: no suggestions, no near-match on a miss (`/lookup?name=strpe` never mentions Stripe), and Search doesn't say how many APIs answer.

## Change
- **Suggestions on Search:** the name field gets a native `<datalist>` of the Index's API names (from `api_names` joined to `apis`, only APIs with a Current Spec; server-rendered with the page, no client fetch). Works without script.
- **A line under the field:** "{N} APIs answer without a key · browse them", N from the Index (`indexStats`), linking to `/vendors`.
- **Near-match on a miss:** the "Not in the Index yet" view first shows "Did you mean …" with up to three Index API names close to what was typed (case-insensitive; a normalized-name edit distance ≤ 2, or the typed text as a prefix/substring of a name), each a link to `/lookup?name=<that name>`, then the Discovery commands as now. No near-match → the view is unchanged.
- Server-side only; no new route, no new dependency; the Lookup's answer itself doesn't change (the near-match is a view concern, computed in `src/server/lookup-page.ts` from the Index).

## Done when
- The shared checks above, on `/`, `/lookup?name=strpe`, `/lookup?name=frobnicator-xyz`.
- Tests: the datalist holds exactly the Index's names with a Current Spec; `strpe` → "Stripe API"; `frobnicator-xyz` → no suggestion; case and spacing don't matter; at most three.
