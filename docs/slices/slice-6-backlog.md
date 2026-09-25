# Slice 6 backlog: Web UI

**Status: DRAFT for Wes, 2026-09-25.** Nothing is filed on Linear. The decisions D1–D9 below each carry a recommendation; nothing is built until Wes approves them (or changes them).

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

- **D1. Impeccable: install it in the repo, pinned.** *Recommended:* the operator runs `npx impeccable install --providers=claude --scope=project` in swagger.bot, checks what it wrote, and commits the skill (pinned at the version installed) so every factory worktree has it. **Hooks off in the repo:** the detector runs where we choose (issue Done-when lists, `uicheck`, and O3), not on every edit a factory agent makes, so a PR's diff and timing stay predictable. The alternative is a global install on this machine only, with the factory building from `PRODUCT.md` and `DESIGN.md` alone; that's simpler but factory agents couldn't run `craft` against the design.
- **D2. Who does what: Impeccable's interactive steps are operator work.** `init` interviews the product owner (who uses it, what it's for, constraints), and the visual direction (`DESIGN.md`, through `shape`) is a design decision. *Recommended:* O1 is a session with Wes that produces `PRODUCT.md`, `DESIGN.md` and a short shape brief for each of the five screens, committed under `docs/design/`. The factory issues then build screens against those files with `/impeccable craft`. `polish` and `audit` are operator passes (O3), whose fixes go out as small PRs.
- **D3. Styling: Tailwind v4 + shadcn, as the PRD says.** *Recommended:* Tailwind 4 through its Vite plugin, and `shadcn` (the CLI, current 4.x) with components copied into `src/components/ui/`, so we own them and they carry Radix's keyboard and ARIA behaviour. Theme tokens (colour, type, radius, spacing) come from `DESIGN.md`, as CSS variables for light and dark. `site.css` stays for `/` until issue #3 replaces the page, and is then deleted. The alternative is plain CSS with Radix primitives; it's leaner, but it drops the PRD's shadcn and the factory's familiarity with it.
- **D4. Rendering: server-rendered pages that read the Index directly.** *Recommended:* each screen is a TanStack Start route whose loader calls a server function over the same answer functions the HTTP API uses (`answerVendorApis`, the Lookup core, `pageOutline`, …), not a `fetch` to our own `/api/…`. Pages render on the server, so the first paint has the content, and links are real links, which is good for the keyboard and for a crawler. Client JavaScript is for the search form, the Published/Normalized switch and the Spec viewer.
- **D5. Search and Lookup: the UI answers from the Index only.** The UI has no API key, and Discovery needs one (Slice 3). *Recommended:* the search form sends a Lookup with no key. An Index answer shows the Lookup result. A name the Index doesn't know shows its own view, "Not in the Index yet", with the `curl` or MCP call that runs Discovery with a key, and the "request a key" link (D9). No key is ever stored in the browser, and there is no `fresh`. Rate limits apply per IP as for any Caller.
- **D6. Spec viewer: Scalar in a sandboxed frame, under its own CSP.** Spec content is untrusted (PRD): descriptions carry Markdown and HTML, and a Spec names servers. *Recommended:*
  - `@scalar/api-reference` (1.72.x), self-hosted from our build, not from a CDN.
  - It renders on its own route, `/embed/specs/{specId}?form=published|normalized`, a standalone HTML document outside the app shell.
  - That route is framed by the viewer page with `<iframe sandbox="allow-scripts">` (no `allow-same-origin`, so the frame has an opaque origin and can't touch the app), and is served with `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src <the Spec's own download URL only>; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`. So a Spec can't run script, load remote images (tracking pixels), or call any server, even if Scalar's own sanitiser misses something.
  - Scalar's options: `hideTestRequestButton`, `hideClientButton`, `telemetry: false`, `withDefaultFonts: false`, `agent` and `mcp` off, `proxyUrl` unset. "Try it" is off twice: by option and by CSP.
  - Our frame around it (on the app page, not in the iframe) shows Provenance, `verifiedAt`, the Published/Normalized switch, Alternate Specs, Validity Issues and the downloads. It never renders Spec text as HTML: every string from a Spec is text.
  - Large Specs: Cloudflare is 26 MB. The viewer loads Scalar only for the chosen form, shows its size first, and for Specs over 10 MB links to the outline and downloads instead of rendering them inline (the threshold is checked in the issue's manual check against Stripe, GitHub and Cloudflare).
- **D7. Index browsing: a new `GET /api/vendors`.** *Recommended:* `GET /api/vendors?cursor=&limit=&query=`: Vendors ordered by name, each with its id, name and API count, 50 per page by default (at most 200), `query` a substring of the id or name. The `/vendors` page uses the same function. **No new MCP tool:** `tools/list` is 28.4 kB, near `mcpcheck`'s 30 kB bound, and an agent reaches Vendors through `lookup_api` and `list_vendor_apis`. The open follow-up that `list_vendor_apis` needs paging past ~20 APIs is left open (not Slice 6).
- **D8. Acceptance:** as at the top. The WCAG AA check is automated (`uicheck`) so every screen issue can run it in its PR, not only at the end. `uicheck` uses Playwright (`playwright` and `@axe-core/playwright` as dev dependencies, Chromium only). The alternative is the headless-Chrome screenshots of earlier slices plus a manual axe run, which catches less and can't run in a PR.
- **D9. "Request a key": where does it go?** Keys are handed out by hand (PRD). *Needs Wes:* a `mailto:` to an address you name, or a GitHub issue form on `evolv3ai/swagger.bot` (public issues would show who asked). *Recommended:* a `mailto:` with a prefilled subject, if you have an address you want public.

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
| 1 | — | The UI foundation: Tailwind, shadcn, the shell, security headers, `uicheck` | O1 | 1 |
| 2 | — | `GET /api/vendors`: the Vendor list, paged | — | 1 |
| 3 | — | Search and the Lookup result | 1 | 2 |
| 4 | — | The Spec viewer: Scalar, sandboxed, in our frame | 1 | 2 |
| 5 | — | Index browsing: Vendors → APIs | 1, 2 | 2 |
| 6 | — | The docs page and "request a key"; the landing page retired | 1, 3 | 3 |

Wave 1 is queued once O1 is merged (#2 can go at once: it has no UI). Wave 2 is queued when #1 merges. Each wave-2 issue adds one route file and one line to the nav list in `src/components/shell/nav.ts`, a mechanical conflict: wave 2 is merged one PR at a time, merging `main` into each, as in Slice 5.

## Operator steps (not factory issues)

- **O1. Impeccable and the design, with Wes** (D1, D2). Install Impeccable (D1). `/impeccable init` → `PRODUCT.md` (Wes answers its interview). Then the visual direction → `DESIGN.md`, and `/impeccable shape` for each of the five screens → `docs/design/<screen>.md`. Commit all of it, and update `.weawr/instructions.md`: point it at this backlog and `docs/design/`, and name the dependencies Slice 6 adds (Tailwind, shadcn's, `@scalar/api-reference`, Playwright, axe).
- **O2. Deploy after each wave**, keeping `docs/deploy.md` current, with `mcpcheck` and `formscheck` after each. After wave 2, headless screenshots of every screen on production.
- **O3. Polish and audit.** `/impeccable polish` and `/impeccable audit` over the whole UI once wave 3 is merged. Fixes go out as small PRs (by the operator, or filed for the factory if they're more than a few lines).
- **O4. Acceptance** (D8), recorded in `docs/slices/slice-6-result.md`: the audit's scores and findings, `uicheck`'s output, `npx impeccable detect`'s output, a keyboard walk of every screen, and screenshots at 390 and 1280 in light and dark. Then Wes looks at it.

---

## 1. swaggerbot: the UI foundation: Tailwind, shadcn, the app shell, security headers and `uicheck`

## Problem
Slice 6 builds five screens (PRD "Surfaces → Web UI"). They need one styling system, one shell, security headers on every page, and a way to check each screen for WCAG AA and keyboard use in its own PR. The visual direction is set in `DESIGN.md` and the product in `PRODUCT.md` (both at the repo root); the shell's shape is in `docs/design/shell.md`.

## Change
- **Styling:** add `tailwindcss` 4 and `@tailwindcss/vite`, and set up `shadcn` (the CLI's `init` for Vite + React, components under `src/components/ui/`, the `cn` helper under `src/lib/`). Theme tokens as CSS variables in `src/styles/app.css`, light and dark (`prefers-color-scheme`), taken from `DESIGN.md`. Add only the shadcn components the shell uses. Fonts are self-hosted (no Google Fonts request), because the CSP below allows `'self'` only.
- **The shell** (`src/components/shell/`): a header with the product mark and the nav, a footer showing `/api/health`, a "Skip to content" link as the first focusable element, and `<main id="content">`. The nav is a list in `src/components/shell/nav.ts`; this issue adds Search (`/`) only. `__root.tsx` renders the shell around `<Outlet />`, except for routes under `/embed/`.
- **`/` keeps the landing page** for now, with `site.css`; it moves inside the shell. Issue #3 replaces it.
- **Security headers on every HTML response** (a Nitro plugin or middleware in `src/server/`): `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. If TanStack Start's hydration needs an inline script, use a per-request nonce, not `'unsafe-inline'`. `/api/…`, `/mcp` and downloads keep their current headers. `/embed/…` gets its own policy in issue #4.
- **`scripts/uicheck.ts <baseUrl> [--routes /,/docs,…] [--json]`** (`playwright` and `@axe-core/playwright`, dev dependencies, Chromium only): for each route, at 390 and 1280 wide and in light and dark, run axe with the tags `wcag2a wcag2aa wcag21aa wcag22aa` and fail on any violation; then press Tab until focus returns to the start, and fail if an interactive element is never reached, if focus is trapped, or if a focused element has no visible focus indicator (its outline or box-shadow is unchanged from unfocused). Also fail on any CSP violation in the console. Save a screenshot of each run under `--out` (default `uicheck-out/`, git-ignored). Exit 1 on any failure.

## Done when
- Tests: the header plugin sets the CSP on an HTML response and not on `/api/health`; `uicheck`'s pass/fail logic on a small fixture page (a missing label, a focus trap).
- `pnpm check` and `pnpm build` green; `uicheck --help`.
- The manual check in the PR: `uicheck` against the built server passes on `/`, output pasted, and the four screenshots attached. The page loads with no CSP violation in the console.

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

## 3. swaggerbot: the Search screen and the Lookup result

## Problem
A person with the name of an API has no way to look it up in a browser. The PRD's Search and Lookup result screens are the UI's front door; the Lookup result has a distinct view for each Outcome. Design: `docs/design/search.md` and `docs/design/lookup-result.md`.

## Change
- **`/` becomes Search**, replacing the landing page: a labelled search field (the name of an API) with optional API Version and a "Include Community Specs" checkbox (`allowCommunity`), submitting with a GET to `/lookup`. A short line on what swagger.bot does, and links to `/vendors` and `/docs`. Delete `src/styles/site.css` and anything only the landing page used.
- **`/lookup?name=…[&apiVersion=…][&allowCommunity=1]`**: a server function runs the Lookup core **with no key** (backlog D5), so only Index answers resolve. One view per Outcome, each with a heading that names the Outcome:
  - **Resolved:** the API, its Vendor, the Current Spec's Provenance and `verifiedAt`, the two download links, Alternate Specs, and a link to the Spec viewer (`/specs/{specId}`).
  - **Ambiguous:** the candidate APIs, each a link that retries the Lookup with that name.
  - **Unconfirmed**, **NoSpec** and **Unknown** (`src/domain/outcome.ts`): what was found, or why nothing was, in the Outcome's own words and fields.
  - **Not in the Index** (Discovery needs a key): says so plainly, shows the `curl` and the MCP call that would run Discovery with a key, and links to `/docs#keys`.
  - A rate-limited request shows when to retry.
- The nav is unchanged (Search is already there).

## Done when
- Tests: the server function for each Outcome (fake Index), that no key is ever sent, and that `name` is required.
- `pnpm check` and `pnpm build` green; `uicheck` passes on `/` and on `/lookup` for each Outcome that the Index copy can produce.
- The manual check in the PR, on a copy of an Index: Stripe (Resolved), a name the copy holds as Ambiguous, and a name it doesn't know, each screenshotted at 390 and 1280.

## 4. swaggerbot: the Spec viewer: Scalar, sandboxed, in our frame

## Problem
A person who has found a Spec wants to read it. The PRD's Spec viewer embeds Scalar with "try it" disabled, inside our frame, and all Spec content is untrusted: it must not be able to run script, load remote content or call any server. Design: `docs/design/spec-viewer.md`. The decision is backlog D6.

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
A person can't see what the Index already holds. The PRD's Index browsing screen lists Vendors, then a Vendor's APIs. Design: `docs/design/index-browsing.md`.

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
The PRD's API and MCP docs page, with the "request a key" link, doesn't exist; the interim landing page carried the route table and the Claude Code block, and issue #3 has replaced it. Design: `docs/design/docs.md`.

## Change
- **`/docs`**: the HTTP API (each route, `GET /api/vendors` included, with a `curl` example and its answer, the route table), MCP (the endpoint, the `claude mcp add` command, the five tools, result sizes), the key rules (a key is optional for Index answers; Discovery and `fresh` need one; quotas and the per-IP limit), and a **Keys** section (`#keys`) with the "request a key" link (backlog D9). Each code block has a Copy button that works by keyboard and says it copied (`aria-live`).
- Add "Docs" to the nav. The README links to `/docs`.
- The route table and Claude Code block exist only here now: remove any copy left from the landing page.

## Done when
- `pnpm check` and `pnpm build` green; `uicheck` passes on `/docs`.
- Every `curl` on the page runs against the built server on a copy of an Index and answers as the page says (paste the runs in the PR).
- The manual check in the PR: screenshots at 390 and 1280, light and dark.
