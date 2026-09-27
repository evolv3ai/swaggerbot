# SwaggerBot design system

SwaggerBot's brand, distilled from its logo package. Tagline: **NAME IT. GET THE SPEC.** (it replaced BETTER THAN SPECS on 27 Sept 2026; the logo lockups in `assets/` carry it).

**Product:** SwaggerBot — "the verified OpenAPI Spec for any API, by name." Send the name of an API; get back its OpenAPI/Swagger Spec, its provenance and a confidence answer — or an honest reason there isn't one. Web lookup at swaggerbot.dev, plus MCP and HTTP API for agents. Pipeline: Index (verified, instant, no key) → Discovery with a key (APIs.guru → developer portal → vendor domain → GitHub → judged).

**Sources:** five logo files (`uploads/`) and the current site https://swaggerbot.dev/ (source: github.com/evolv3ai/swaggerbot). **This is a rebrand:** the site supplies content, voice and information architecture only — its amber visual theme (#dc9530) is being retired and must not be carried over. Visuals come from the new logos.

## Content fundamentals
- Voice: blunt, honest, confident. The promise is trust, not speed: "No fake Specs." / "tells you straight why there isn't one" / "Not sure means we say so." The tagline NAME IT. GET THE SPEC. says what you do; "No fake Specs." says why to trust it; body copy stays plain and factual.
- Proof over adjectives: show numbers and receipts ("Answered in 1.7ms", "0 wrong of 20 Resolved answers", "How it was measured").
- Casing: sentence case for headings and UI. **Product nouns are capitalised as proper terms:** Spec, Index, Vendor, Lookup, Discovery, Provenance, and the five answers. ALL CAPS only for tracked-out tagline/eyebrows and badges.
- The five answers (always this order, sure → not found): **Resolved**, **Unconfirmed**, **Ambiguous**, **No Spec**, **Unknown**. Short forms: Unconf., Ambig. Provenance tiers, strongest first: Official, Endorsed, Mirror, Community.
- Person: SwaggerBot speaks in third person or "we"; addresses "you". Never "I".
- British spelling and dates: "organisation", "24 Sept 2026".
- No emoji. The robot mark is the personality.
- Examples: "Name it. Get the Spec." · "No fake Specs." · "From the Index, anyone. Past it, Discovery, with an API key." · "For agents and programs: the same answers over MCP and the HTTP API." · Buttons are verbs: "Look up", "Copy Spec URL", "Read the docs".

## Visual foundations
- **Color:** SwaggerBot Blue `#0099DD` (mark, tagline, primary actions), Navy `#021C41` (wordmark, text on light), Ink `#111827` (dark ground), White. All sampled from the logo files. Cool navy-tinted neutral ramp; status green/amber/red added for UI. Blue is a fill colour for actions and marks; for body-size blue text on white use `--blue-700` (`--accent-text`) for contrast.
- **Themes:** in these tokens light (white ground, navy text) is the base and `[data-theme="dark"]` flips to ink ground, white text — matching the two official lockups. Both are first-class. **swaggerbot.dev defaults to dark**; light is the visitor's choice.
- **Type:** Montserrat 700/800 for display (matches the wordmark), IBM Plex Sans for body, JetBrains Mono for code/paths/tags. Docs-site scale: body 15px on 1.6, page titles 40px (28px on phones), section headings 20px, tracking −0.01em. Tagline style: Montserrat Bold caps, 12px, 0.3em tracking, in `--accent-text` (the blue that passes AA as text in both themes). Each face is followed by a metric-matched local fallback (`fonts.css`) so the swap to the webfont doesn't move the page.
- **Shape:** derived from the mark — one heavy stroke weight, rounded-rect head (large radius), softer inner radius, pill mouth, circle eyes. So: 2px borders on inputs/secondary buttons, radii 10px (controls), 16px (cards), 24px (dialogs), pills for badges/switches, circular status dots ("eyes").
- **Backgrounds:** flat white or flat ink. No gradients, no textures, no photography supplied. Let whitespace and the blue mark carry the page.
- **Cards:** 16px radius, 1px `--border`; raised = soft navy-tinted shadow; outline = 2px blue with a soft lift (`--shadow-box`; one highlight per view, like the Lookup box); content = 12px radius for answers, tables and commands.
- **Elevation:** light theme uses navy-tinted soft shadows; dark theme uses a 1px edge + ambient black.
- **Motion:** quick and mechanical — 120–180ms, `--ease-out`. Switch thumbs and small toggles use a slight overshoot (`--ease-bounce`) for a robotic "click". No long fades or parallax.
- **States:** the primary button is blue with **navy** text (white on `#0099DD` is 3.2:1, under AA; navy is 5.3:1); its hover and press go **lighter** (`blue-400`, `blue-300`) in both themes so the navy keeps its contrast. Secondary buttons pick up a blue border on hover; press = 1px nudge down; focus = a 2px solid blue outline at 2px offset (inputs also turn their edge blue); disabled = 45% opacity. Text fields use `--border-input` (`gray-500`), which is 3:1 against their ground.
- **Links:** always underlined (1px at 0.2em, 2px on hover), so colour is never the only signal. Nav items and links shaped as buttons or chips opt out.
- **High Contrast:** forced colours drop fills and shadows, so every "you are here" marker has a fallback in `components.css`: a thick underline on the selected tab, the system's Highlight on the chosen segment and on `.sb-current` items.
- **Transparency/blur:** the modal scrim (ink at 60%), soft tints in dark theme, and the sticky top bar (page ground at 85% with an 8px blur). No other glass.
- **Layout:** centered, symmetric lockups for brand moments (the logo is always centered-stacked); left-aligned content in UI. 4px spacing grid.

## Iconography
- No icon set was supplied. Substitute: **Lucide** (CDN `https://unpkg.com/lucide@0.460.0`) at 2–2.5px stroke with round caps/joins — the closest match to the mark's heavy rounded strokes. Flagged substitution.
- No emoji, no unicode glyph icons (except × for dismiss).
- Logo assets in `assets/`: `logo-primary.png` (navy wordmark, transparent), `logo-reversed.png` (white wordmark, transparent — for dark grounds; recoloured from the master), `mark.png` (robot head only), `mark-white.png` (robot head in white, for one-colour use on dark or blue grounds), `wordmark.png` / `wordmark-reversed.png` (wordmark + tagline). Never redraw or recolour the mark; it's always SwaggerBot Blue.

## Answer → colour mapping
Resolved = success green · Unconfirmed = warning amber · Ambiguous = accent blue · No Spec = neutral · Unknown = outline. Use the `AnswerBadge` component; never invent other states.

Provenance: Official = accent with the dot · Endorsed = neutral · Mirror = outline · Community = dashed outline. Use `ProvenanceBadge`, next to every Spec.

## Components
All in `components/`, exported on the bundle namespace; classes live in `tokens/components.css`.
- actions: **Button**, **IconButton**
- forms: **Input**, **Select**, **Checkbox**, **Radio**, **Switch**
- display: **Card**, **Badge**, **Tag**, **AnswerBadge** (the product's five-answer vocabulary), **ProvenanceBadge** (the four tiers), **MethodBadge** (GET/POST tags for HTTP API routes)
- navigation: **Tabs**
- feedback: **Dialog**, **Toast**, **Tooltip**

No source component inventory existed, so this is a standard set sized to the brand.

## Index
- `styles.css` — entry point (imports only) → `tokens/fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `base.css`, `components.css`
- `guidelines/` — foundation specimen cards (brand, colors, type, spacing)
- `components/<group>/` — `.jsx` + `.d.ts` + `.prompt.md` + one card per group
- `assets/` — logos (`assets/source/` holds the logo package's original renders)
- `ui_kits/website/` — swaggerbot.dev rebuilt in the new brand (Search, Lookup result, Vendors, Docs)
- `thumbnail.html` — project tile
- `SKILL.md` — agent-skill entry

## Caveats
- Fonts load from Google Fonts here; Montserrat is inferred from the wordmark, Plex Sans/JetBrains Mono are chosen companions. swaggerbot.dev self-hosts them (its CSP allows fonts from itself only).

## Adopted from the build (27 Sept 2026)
These came back from swaggerbot.dev (github.com/evolv3ai/swaggerbot, `DESIGN.md` → "Adaptations from the kit"), where each one was measured or decided: navy on-accent text and lighter hover/press; the 2px focus outline; input edge tokens; docs-site type scale; always-underlined links; 12px content cards and the lifted outline card; badge tracking 0.06em, full-text neutral and the outline tone; the code-block Tabs and the pill segmented control; code and method-tag tokens; metric-matched font fallbacks; High Contrast markers; ProvenanceBadge and MethodBadge; the new tagline.
