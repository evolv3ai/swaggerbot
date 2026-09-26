# SwaggerBot design system

SwaggerBot's brand, distilled from its logo package. Tagline: **BETTER THAN SPECS**.

**Product:** SwaggerBot — "the verified OpenAPI Spec for any API, by name." Send the name of an API; get back its OpenAPI/Swagger Spec, its provenance and a confidence answer — or an honest reason there isn't one. Web lookup at swaggerbot.dev, plus MCP and HTTP API for agents. Pipeline: Index (verified, instant, no key) → Discovery with a key (APIs.guru → developer portal → vendor domain → GitHub → judged).

**Sources:** five logo files (`uploads/`) and the current site https://swaggerbot.dev/ (source: github.com/evolv3ai/swaggerbot). **This is a rebrand:** the site supplies content, voice and information architecture only — its amber visual theme (#dc9530) is being retired and must not be carried over. Visuals come from the new logos.

## Content fundamentals
- Voice: blunt, honest, confident. The promise is trust, not speed: "No fake Specs." / "tells you straight why there isn't one" / "Not sure means we say so." The tagline BETTER THAN SPECS carries the swagger; body copy stays plain and factual.
- Proof over adjectives: show numbers and receipts ("Answered in 1.7ms", "0 wrong of 20 Resolved answers", "How it was measured").
- Casing: sentence case for headings and UI. **Product nouns are capitalised as proper terms:** Spec, Index, Vendor, Lookup, Discovery, Provenance, and the five answers. ALL CAPS only for tracked-out tagline/eyebrows and badges.
- The five answers (always this order, sure → not found): **Resolved**, **Unconfirmed**, **Ambiguous**, **No Spec**, **Unknown**. Short forms: Unconf., Ambig. Provenance values: Official, Community.
- Person: SwaggerBot speaks in third person or "we"; addresses "you". Never "I".
- British spelling and dates: "organisation", "24 Sept 2026".
- No emoji. The robot mark is the personality.
- Examples: "No fake Specs." · "Name an API." · "From the Index, anyone. Past it, Discovery, with an API key." · "For agents and programs: the same answers over MCP and the HTTP API." · Buttons are verbs: "Look up", "Copy Spec URL", "Read the docs".

## Visual foundations
- **Color:** SwaggerBot Blue `#0099DD` (mark, tagline, primary actions), Navy `#021C41` (wordmark, text on light), Ink `#111827` (dark ground), White. All sampled from the logo files. Cool navy-tinted neutral ramp; status green/amber/red added for UI. Blue is a fill colour for actions and marks; for body-size blue text on white use `--blue-700` (`--accent-text`) for contrast.
- **Themes:** light (white ground, navy text) is default; `[data-theme="dark"]` flips to ink ground, white text — matching the two official lockups. Both are first-class.
- **Type:** Montserrat 700/800 for display (matches the wordmark), IBM Plex Sans for body, JetBrains Mono for code/paths/tags. Tagline style: Montserrat Bold caps, 0.5em tracking, blue.
- **Shape:** derived from the mark — one heavy stroke weight, rounded-rect head (large radius), softer inner radius, pill mouth, circle eyes. So: 2px borders on inputs/secondary buttons, radii 10px (controls), 16px (cards), 24px (dialogs), pills for badges/switches, circular status dots ("eyes").
- **Backgrounds:** flat white or flat ink. No gradients, no textures, no photography supplied. Let whitespace and the blue mark carry the page.
- **Cards:** 16px radius, 1px `--border`; raised = soft navy-tinted shadow; outline = 2px blue (one highlight per view).
- **Elevation:** light theme uses navy-tinted soft shadows; dark theme uses a 1px edge + ambient black.
- **Motion:** quick and mechanical — 120–180ms, `--ease-out`. Switch thumbs and small toggles use a slight overshoot (`--ease-bounce`) for a robotic "click". No long fades or parallax.
- **States:** hover = one ramp step darker (light) / lighter (dark); secondary buttons pick up a blue border on hover; press = 1px nudge down + deeper blue; focus = 3px 40% blue ring; disabled = 45% opacity.
- **Transparency/blur:** only for the modal scrim (ink at 60%) and soft tints in dark theme. No glassmorphism.
- **Layout:** centered, symmetric lockups for brand moments (the logo is always centered-stacked); left-aligned content in UI. 4px spacing grid.

## Iconography
- No icon set was supplied. Substitute: **Lucide** (CDN `https://unpkg.com/lucide@0.460.0`) at 2–2.5px stroke with round caps/joins — the closest match to the mark's heavy rounded strokes. Flagged substitution.
- No emoji, no unicode glyph icons (except × for dismiss).
- Logo assets in `assets/`: `logo-primary.png` (navy wordmark, transparent), `logo-reversed.png` (white wordmark, transparent — for dark grounds; recoloured from the master), `mark.png` (robot head only), `wordmark.png` / `wordmark-reversed.png` (wordmark + tagline). Never redraw or recolour the mark; it's always SwaggerBot Blue.

## Answer → colour mapping
Resolved = success green · Unconfirmed = warning amber · Ambiguous = accent blue · No Spec = neutral · Unknown = neutral outline. Use the `AnswerBadge` component; never invent other states.

## Components
All in `components/`, exported on the bundle namespace; classes live in `tokens/components.css`.
- actions: **Button**, **IconButton**
- forms: **Input**, **Select**, **Checkbox**, **Radio**, **Switch**
- display: **Card**, **Badge**, **Tag**, **AnswerBadge** (intentional addition: the product's five-answer vocabulary)
- navigation: **Tabs**
- feedback: **Dialog**, **Toast**, **Tooltip**

No source component inventory existed, so this is a standard set sized to the brand.

## Index
- `styles.css` — entry point (imports only) → `tokens/fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `base.css`, `components.css`
- `guidelines/` — foundation specimen cards (brand, colors, type, spacing)
- `components/<group>/` — `.jsx` + `.d.ts` + `.prompt.md` + one card per group
- `assets/` — logos
- `ui_kits/website/` — swaggerbot.dev rebuilt in the new brand (Search, Lookup result, Vendors, Docs)
- `thumbnail.html` — project tile
- `SKILL.md` — agent-skill entry

## Caveats
- Fonts load from Google Fonts; Montserrat is inferred from the wordmark, Plex Sans/JetBrains Mono are chosen companions.
- No product UI supplied, so there are no UI kits; component examples use representative spec-search copy.
