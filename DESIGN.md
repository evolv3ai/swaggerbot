---
name: SwaggerBot
description: The verified OpenAPI Spec for any API, by name, in a docs site a little more attractive than the rest.
colors:
  blue: "#0099dd"
  navy: "#021c41"
  ink: "#111827"
  white: "#ffffff"
  blue-50: "#eaf7fd"
  blue-200: "#99d7f3"
  blue-300: "#5cbfeb"
  blue-400: "#26aae4"
  blue-700: "#006696"
  gray-0: "#ffffff"
  gray-50: "#f6f8fb"
  gray-100: "#edf1f6"
  gray-200: "#dce2eb"
  gray-300: "#c1cad7"
  gray-400: "#96a1b2"
  gray-500: "#6b7688"
  gray-600: "#4b5568"
  gray-700: "#343d4f"
  gray-800: "#1f2737"
  gray-900: "#111827"
  gray-950: "#0a0f1a"
  green-500: "#17a56b"
  amber-500: "#e9a21b"
  red-500: "#e2483d"
  code-bg: "#07090b"
  code-text: "#cfd5de"
typography:
  page-title:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  section-heading:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
  eyebrow:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.3em"
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  lead:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  xl: "24px"
  pill: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.navy}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.blue-400}"
  card:
    backgroundColor: "{colors.gray-800}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.gray-900}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 12px"
  badge:
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  code-block:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.code-text}"
    rounded: "{rounded.md}"
---

# Design System: SwaggerBot

## Overview

The Web UI is built on the **SwaggerBot design system v2** (`docs/design/swaggerbot-design-system-v2/`: its `readme.md`, `tokens/` and `components/` are the source kit; this file describes how the app carries it). `PRODUCT.md` holds the binding decisions: the design system is binding, every page is a Mintlify-grade docs site "just slightly more attractive than all the other docs sites", and **dark is the default theme**, light the visitor's alternate.

Tailwind v4 carries the tokens in `src/styles/app.css`. The design system's semantic tokens are namespaced `--sb-*` (so they don't collide with Tailwind's and shadcn's own `--accent`, `--border`, `--text-sm`) and exposed as utilities (`bg-sb-surface`, `text-sb-text-muted`, `border-sb-border`, …). shadcn's names (`background`, `card`, `primary`, `ring`, …) are mapped onto them. `:root` holds the dark theme; `[data-theme="light"]` on `<html>` holds the light one. The theme toggle in the top bar sets it, remembers it in localStorage, and an inline script in `__root.tsx` applies it before first paint; without script the page is dark. `dark:` follows that attribute, not the OS setting. Faces are self-hosted in `src/styles/fonts.css` (the CSP allows `font-src 'self'` only).

## Colors

Brand colours are sampled from the logo files: SwaggerBot Blue `#0099DD`, Navy `#021C41`, Ink `#111827`, white. A cool navy-tinted gray ramp and three status hues (green, amber, red) complete the palette. Components use only the semantic tokens:

| Token | Dark (default) | Light |
|---|---|---|
| `sb-bg` / `sb-bg-subtle` | gray-900 / gray-950 | white / gray-50 |
| `sb-surface` / `-raised` / `-sunken` | gray-800 / gray-700 / gray-950 | white / white / gray-100 |
| `sb-text` / `-muted` / `-faint` | white / gray-300 / gray-400 | navy / gray-600 / gray-500 |
| `sb-border` / `-strong` | gray-700 / gray-600 | gray-200 / gray-300 |
| `sb-accent` | blue | blue |
| `sb-accent-text` (blue text) | blue-300 | blue-700 |
| `sb-text-on-accent` | navy | navy |
| `sb-success/warning/danger` (+ `-soft`, `-text`) | status hue, 20% tint, light text | status hue, 100 tint, dark text |
| `sb-code-bg` / `sb-code-text` | `#07090B` / `#CFD5DE` | gray-900 / `#CFD5DE` |

- **Text on the blue fill is navy, not white**: white on `#0099DD` is 3.2:1, under WCAG AA; navy is 5.3:1.
- **Blue text** at body size uses `sb-accent-text`, never raw `sb-blue`.
- **Code is ink in both themes.**
- **The five answers** have fixed colours (the kit's "Answer → colour mapping"): Resolved green, Unconfirmed amber, Ambiguous blue, No Spec neutral, Unknown outline. Use `AnswerBadge`; the answer's name is always written, so colour is never the only signal.

## Typography

- **Display: Montserrat 700/800.** Page titles (800, 28px → 40px from `sm`, sentence case), section headings (700, 1.25rem), buttons, badges, and the eyebrow (700, 0.75rem, uppercase, 0.3em tracking, `sb-accent-text`). The eyebrow is the brand tagline, BETTER THAN SPECS, on Search only: no page carries a category kicker above its title (the sidebar and the title say where the visitor is), and a Lookup says the name looked up in plain text under its lead.
- **Body: IBM Plex Sans 400/500/600**, 15px on 1.6. The lead under a title is 17px in `sb-text-muted`, at most 40em wide.
- **Mono: JetBrains Mono** for code, URLs, ids, paths and HTTP methods, usually at 13px.
- Every link is underlined (WCAG 1.4.1); only nav items, the home mark, the skip link and links shaped as buttons or chips opt out with `no-underline`. The Vendors table's names opt out too: each is the bold link of its row (the whole row is the target), underlined on hover and focus.
- A Spec's download command shows on one line (`curl -o openapi.yaml …/specs/1fdc1047…78a9/published`, the id elided and in the accent; `CodeBlock`'s `oneLine`, via `SpecDownloadCurl`); Copy and screen readers get the whole URL. Other code blocks wrap as before.
- A Lookup states its answer once above the card: the heading names it, the card carries the badge.
- Every route's main column shares one measure (`max-w-[860px]`), the Spec viewer's included.

## Layout

The docs shell (`src/components/shell/`), after the approved mock in `docs/design/approved-mock/`:

- **Top bar**, sticky, 60px: the logo, the ⌘K quick Lookup (from `md`), Vendors and GitHub links and the service status (from `lg`), the theme toggle, the "Get an API key" button, and below `lg` a menu button that opens a drawer. Its ground is `sb-bg` at 85% with an 8px backdrop blur.
- **Left sidebar** (256px, from `lg`), sticky under the top bar, with a right border. Below `lg` its links are in the drawer.
- **"On this page" rail** (from `xl`), built from a page's `h2`s that carry an `id`; the section in view is marked as it scrolls.
- Content max width 1440px overall. Anchors land below the top bar (`scroll-padding-top: 5rem`).
- 4px spacing grid; sections sit 2.5rem apart.

## Elevation & Depth

Mostly flat, with depth by surface tone. Dark: a 1px edge plus ambient black (`--sb-shadow-md`, `--sb-shadow-lg`). Light: soft navy-tinted shadows. `--sb-shadow-box` is the lift on the one highlighted (`outline`) card per view. No gradients, textures or glassmorphism beyond the top bar's blur.

## Shapes

From the mark: one heavy stroke weight, a rounded head, a pill mouth, circle eyes. Radii 6px (small), 10px (controls, code), 16px (cards), 24px (dialogs); pills for badges and switches; round status dots ("eyes"). Inputs and secondary buttons carry a 2px edge.

## Components

The primitives live in `src/components/ui/`, each after the kit's component of the same name:

- **Button** (`button.tsx`): `primary` (blue fill, the one key action per view), `secondary` (2px outline, blue edge on hover), `ghost`; 32/40/48px tall. Hover is one ramp step lighter; press nudges 1px down. `buttonClass` styles a link as a button.
- **Input** (`input.tsx`): 2px edge, 10px radius, the edge turns blue on focus; `mono` for URLs and ids.
- **Card** (`card.tsx`): 16px radius, 1px edge; `outline` is the 2px blue highlight, once per view; `raised` trades the edge for a shadow.
- **Badge** (`badge.tsx`): a 22px pill in Montserrat bold capitals; tones accent, neutral, success, warning, danger, outline; `dot` adds the status eye. **AnswerBadge** and **ProvenanceBadge** build on it (Provenance: Official and Endorsed filled, Mirror outlined, Community dashed).
- **MethodBadge** (`method-badge.tsx`): an HTTP method tag in mono.
- **Tabs** (`tabs.tsx`): the WAI-ARIA tabs pattern; without script the first panel shows.
- **CodeBlock** (`code-block.tsx`): code on the ink ground with a Copy button and a polite live region.

Motion is quick and mechanical: 120–180ms on `--sb-ease-out`; `--sb-ease-bounce` only for small toggles. Focus is a 2px `ring` outline at 2px offset.

## Do's and Don'ts

- **Do** use the `sb-*` utilities (or the shadcn names mapped onto them), never raw hex, in components.
- **Do** check every page in both themes, at phone and desktop widths (`scripts/uicheck.ts`).
- **Do** use the logos as supplied (`public/brand/`), never redrawn or recoloured.
- **Don't** fill passive surfaces with blue; the blue fill is for the one primary action and the mark.
- **Don't** put white text on the blue fill.
- **Don't** invent answer states or colours beyond the five.
- **Don't** bring back anything from the retired themes (the interim navy page, the Darkroom's amber); `PRODUCT.md` retired them.
