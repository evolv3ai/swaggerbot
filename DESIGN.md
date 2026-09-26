---
name: SwaggerBot
description: The verified OpenAPI Spec for any API, by name, in a docs site a little more attractive than the rest.
colors:
  swaggerbot-blue: "#0099dd"
  navy: "#021c41"
  ink: "#111827"
  white: "#ffffff"
  blue-50: "#eaf7fd"
  blue-200: "#99d7f3"
  blue-300: "#5cbfeb"
  blue-400: "#26aae4"
  blue-700: "#006696"
  gray-50: "#f6f8fb"
  gray-100: "#edf1f6"
  gray-200: "#dce2eb"
  gray-300: "#c1cad7"
  gray-400: "#96a1b2"
  gray-500: "#6b7688"
  gray-600: "#4b5568"
  gray-700: "#343d4f"
  gray-800: "#1f2737"
  gray-950: "#0a0f1a"
  green-500: "#17a56b"
  green-100: "#d4f2e4"
  green-text-dark: "#5fd3a2"
  green-text-light: "#0b7a4d"
  amber-500: "#e9a21b"
  amber-100: "#fcedcf"
  amber-text-dark: "#f5c766"
  amber-text-light: "#8a5a00"
  red-500: "#e2483d"
  red-100: "#fbddda"
  red-text-dark: "#f48a82"
  red-text-light: "#b42a20"
  code-ground: "#07090b"
  code-text: "#cfd5de"
  code-keyword: "#8fbaff"
  method-post-light: "#1d4ed8"
typography:
  display:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  title:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.6
  tagline:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.3em"
  lead:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
  badge:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.06em"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  sm: "6px"
  md: "10px"
  content: "12px"
  lg: "16px"
  pill: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "14": "56px"
components:
  button-primary:
    backgroundColor: "{colors.swaggerbot-blue}"
    textColor: "{colors.navy}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.blue-400}"
  button-primary-active:
    backgroundColor: "{colors.blue-300}"
  button-secondary:
    backgroundColor: "transparent"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-ghost:
    backgroundColor: "transparent"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-sm:
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 12px"
  button-lg:
    rounded: "{rounded.md}"
    height: "48px"
    padding: "0 24px"
  input:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.gray-800}"
    rounded: "{rounded.lg}"
  card-content:
    backgroundColor: "{colors.gray-800}"
    rounded: "{rounded.content}"
    padding: "16px"
  lookup-box:
    backgroundColor: "{colors.gray-800}"
    rounded: "{rounded.lg}"
    padding: "18px"
  badge:
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  code-block:
    backgroundColor: "{colors.code-ground}"
    textColor: "{colors.code-text}"
    typography: "{typography.code}"
    padding: "14px 16px"
  top-bar:
    height: "60px"
    padding: "0 24px"
  sidebar:
    width: "256px"
    padding: "26px 20px"
---

# Design System: SwaggerBot

## Overview

**Creative North Star: "The Docs Page That Answers"**

SwaggerBot swims in a sea of docs sites, and it wears their clothes on purpose: a sticky top bar with a ⌘K Lookup, a left sidebar, an "On this page" rail, one reading column. Every screen, the front door included, is a docs page; the one thing that sets it apart is that the page answers. A developer types the name of an API and the page hands back the Spec, its Provenance and a `curl` to copy. The attractiveness is in the finish, not in costume: the ink ground, the one blue, Montserrat's heavy headings against quiet Plex body text, and the robot mark as the only personality.

The system is the **SwaggerBot design system v2** (`docs/design/swaggerbot-design-system-v2/`: `tokens/`, `components/`, `assets/`), which `PRODUCT.md` makes binding, laid out as the approved mock (`docs/design/approved-mock/mock.html`). Tailwind v4 carries it in `src/styles/app.css`: the kit's primitives keep their names (`--blue-*`, `--gray-*`, `--green-*`); its semantic tokens are namespaced `--sb-*` (`--sb-bg`, `--sb-text-muted`, `--sb-accent-text`, …) so they don't collide with Tailwind's and shadcn's own `--accent`, `--border`, `--text-sm`, and are exposed as utilities (`bg-sb-surface`, `text-sb-text-muted`, `border-sb-border`). shadcn's names (`background`, `card`, `primary`, `ring`, …) are mapped onto them. Density is a docs site's: 15px body, generous section spacing, cards only where content is a unit (an answer, a table, a command).

**Dark is the default** (`PRODUCT.md`). `:root` holds the dark theme, `[data-theme="light"]` on `<html>` the light one; the top bar's toggle sets it, remembers it in localStorage, and an inline script in `__root.tsx` applies it before first paint. Without script the page is dark. Tailwind's `dark:` variant follows the attribute, not the OS.

**Key Characteristics:**
- A Mintlify-grade docs shell on every page but `/embed/…`: 60px top bar, 256px sidebar, 220px "On this page" rail, one 860px column.
- Ink ground, white text; SwaggerBot Blue only for the mark, the one primary action, the one highlighted box and the active nav item.
- Montserrat 800 page titles, Montserrat 700 section headings, IBM Plex Sans body, JetBrains Mono for anything copyable.
- The five answers as coloured, always-labelled pill badges.
- Flat, edge-defined surfaces; one lifted, blue-outlined box per view.

### Adaptations from the kit

Where the build departs from the design system's files, this table records how, and why where the reason is known. These are the system now; don't "fix" them back to the kit.

| Kit says | Build does | Why |
|---|---|---|
| Light is the default theme; `[data-theme="dark"]` flips | Dark is the default; `[data-theme="light"]` flips | `PRODUCT.md` Brand Commitments (Wes, 2026-09-26). |
| `--text-on-accent` is white | Navy (`--sb-text-on-accent`) | White on `#0099DD` is 3.2:1, under WCAG AA; navy is 5.3:1. Wes's decision. |
| Light-theme hover/press go darker (`blue-600`/`blue-700`) | Lighter in both themes (`blue-400` hover, `blue-300` press) | Navy text keeps its contrast only on the lighter blues. |
| Focus is a 3px 40% blue box-shadow ring | A 2px solid `ring` (blue) outline at 2px offset; inputs also turn their edge blue | Reason not recorded; as built with the tokens (`320b36a`). The approved mock has no focus style to follow. |
| Body 16px on 1.55 | 15px on 1.6 | The approved mock; docs-site density. |
| h1 48px, tracking −0.02em | Page titles 28px, 40px from `sm`, tracking −0.01em; section headings 20px | The approved mock. |
| Eyebrow tracking 0.22em, tagline 0.5em, colour raw blue | The tagline at 12px, 0.3em, in `--sb-accent-text` | The mock's setting; `--sb-accent-text` is the blue that passes AA as text in both themes. |
| Links: 2px underline, 3px offset | Every link underlined, 1px at 0.2em offset, 2px on hover | Always underlined for WCAG 1.4.1 (colour is not the only signal); the 1px weight is as built (`d75a2c3`), reason not recorded. |
| Cards 16px radius | The kit's 16px for `Card` and the Lookup box; content cards (answers, tables, commands) set 12px | The approved mock's `.c` and `.res` cards are 12px; only its `.box` is 16px. |
| `outline` card has no shadow | The outline card carries `--sb-shadow-box` | The mock's Lookup box lifts; it is the one highlight per view. |
| Input fill is `--surface` | `--sb-bg` | Reason not recorded (`a2fe4e8`); the Lookup box's field sits on the page ground inside the card. |
| Tabs: Montserrat 600, accent text, 3px pill underline, 2px track | Plex 13px medium, selected text white/navy with a 2px inset blue underline, no track | The mock's code tabs; Montserrat 600 is not self-hosted. |
| Form label Montserrat 600 | Montserrat 700 | Only 700 and 800 are self-hosted. |
| Badge letter-spacing 0.04em; `neutral` in muted text | 0.06em; `neutral` in full text on `--sb-border` (dark) or `--sb-surface-sunken` (light); an extra `outline` tone | The kit's answer mapping names an outline for Unknown, which its Badge lacks; the tracking and the neutral text are as built (`a2fe4e8`), reason not recorded. |
| No glassmorphism; blur only for the modal scrim | The top bar is `--sb-bg` at 85% with an 8px backdrop blur | The approved mock's top bar. The only blur in the system. |
| Fonts from Google Fonts | Self-hosted in `src/styles/fonts.css` (Montserrat 700/800, Plex Sans 400/500/600, JetBrains Mono) | The CSP allows `font-src 'self'` only. |
| No code tokens | `--sb-code-bg`/`--sb-code-text`: ink in both themes; `code-keyword` `#8fbaff` for the command word | The mock's code blocks. |
| Radius xs 4px, xl 24px (dialogs) | Not used; no dialog is built (the drawer is square-edged) | Nothing yet needs them. |
| Select, Checkbox, Radio, Switch, Tag, Dialog, Toast, Tooltip, IconButton; `navy` and `danger` buttons | Not built | No screen needs them yet. Build them from the kit when one does. |
| The website UI kit's primary action says "Develop" | "Look up" | The kit's own content rule (buttons are verbs, "Look up"); Wes was told and didn't object. |
| Scalar (the Spec viewer) in the site's fonts | Scalar's colours map to the tokens (`SCALAR_CSS` in `src/server/spec-embed.ts`), but its fonts fall back to the system's | The sandboxed frame has an opaque origin and can't load the site's fonts. |

## Colors

One brand blue on a cool, navy-tinted neutral ramp, three status hues, and an ink code ground. Components use the semantic `--sb-*` tokens (or the utilities over them), never these hex values directly.

### Primary
- **SwaggerBot Blue** (`swaggerbot-blue`): the mark, the fill of the one primary action per view, the 2px outline of the one highlighted box, the focus ring, the active tab's underline, the checkbox accent. Sampled from the logo. As text it is replaced by `--sb-accent-text`.
- **Blue as text** (`--sb-accent-text`: `blue-300` dark, `blue-700` light): body-size blue text, the tagline, the active sidebar item. `blue-400` and `blue-300` are the primary button's hover and press in both themes.
- **Blue tint** (`--sb-accent-soft`: 18% blue dark, `blue-50` light; text `--sb-accent-soft-text`: `blue-200` / `blue-700`): the active sidebar item's ground, hovered rows and ghost buttons, the Ambiguous and Official badges, the GET method tag.

### Neutral
- **Ink** (`ink`, gray-900): the dark ground (`--sb-bg`), and the code ground in the light theme.
- **Navy** (`navy`): text on light, and text on the blue fill in both themes.
- **The gray ramp** (`gray-50` … `gray-950`), by role:

| Token | Dark (default) | Light |
|---|---|---|
| `--sb-bg` / `--sb-bg-subtle` | ink / gray-950 | white / gray-50 |
| `--sb-surface` / `-raised` / `-sunken` | gray-800 / gray-700 / gray-950 | white / white / gray-100 |
| `--sb-text` / `-muted` / `-faint` | white / gray-300 / gray-400 | navy / gray-600 / gray-500 |
| `--sb-border` / `-strong` | gray-700 / gray-600 | gray-200 / gray-300 |
| `--sb-code-bg` / `--sb-code-text` | `code-ground` / `code-text` | ink / `code-text` |

### Status
- **Green, amber, red** (`green-500`, `amber-500`, `red-500`), each with a soft ground (20% of the hue in dark; `-100` in light) and a text colour (`*-text-dark`, `*-text-light`). They mean Resolved, Unconfirmed and failure, nothing else. Green is also the service-status "eye".
- **Code keyword** (`code-keyword`): the command word in a code block (`curl`, `claude`) and the POST method tag's text in dark; `method-post-light` is POST's text in light.

### Named Rules
**The One Blue Rule.** The blue fill marks the one primary action and the mark; the blue outline marks the one highlighted box. Passive surfaces are never filled blue.

**The Navy On Blue Rule.** Text on the blue fill is navy (`--sb-text-on-accent`), in both themes. White on blue fails AA.

**The Five Colours Rule.** The five answers have fixed colours: Resolved green, Unconfirmed amber, Ambiguous blue, No Spec neutral, Unknown outline. There are no other answer states and no other answer colours.

## Typography

**Display Font:** Montserrat 700/800 (with ui-sans-serif, system-ui)
**Body Font:** IBM Plex Sans 400/500/600 (with ui-sans-serif, system-ui)
**Label/Mono Font:** JetBrains Mono (with ui-monospace)

**Character:** Montserrat is the wordmark's face, heavy and geometric, used for headings, labels, buttons and badges; Plex is a plain technical reader's face for everything else; JetBrains Mono marks what can be copied.

### Hierarchy
- **Display** (Montserrat 800, 40px from `sm` and 28px below it, 1.1, −0.01em): the page title, one per page, sentence case.
- **Headline** (Montserrat 700, 20px, −0.01em): a section heading (`h2`), 40px above, 14px below. Only `h2`s with an `id` feed the "On this page" rail.
- **Title** (Plex 600, 15px): a card's heading, the API name in an answer card.
- **Lead** (Plex 400, 17px, `--sb-text-muted`, at most 40em): the sentence under a page title.
- **Body** (Plex 400, 15px, 1.6): running text, at most 40em in prose blocks; secondary copy in cards is 13–13.5px muted.
- **Label** (Montserrat 700, 13px): form labels. Buttons use Montserrat 700 at 13/14/16px by size.
- **Badge** (Montserrat 700, 11px, uppercase, 0.06em): badges only. Table column heads use the same face at 11px, uppercase, 0.12em, muted.
- **Tagline** (Montserrat 700, 12px, uppercase, 0.3em, `--sb-accent-text`): BETTER THAN SPECS, the brand's tagline, above Search's title and nowhere else.
- **Code** (JetBrains Mono, 12.5px on 1.7 in code blocks; 13px in mono inputs; 12px for domains under a Vendor name): code, URLs, ids, paths, HTTP methods.

### Named Rules
**The One Tagline Rule.** BETTER THAN SPECS above Search's title is the only line above any page title. No page carries a category kicker or eyebrow: the sidebar and the title already say where the visitor is. A Lookup names what was looked up in plain text under its lead.

**The Underlined Link Rule.** Every link is underlined (WCAG 1.4.1). Only nav items, the home mark, the skip link, links shaped as buttons or chips, and the Vendors table's names opt out, with `no-underline`. A Vendor's name is the bold link of its row (the whole row is the target, and highlights), underlined on hover and focus.

**The Copyable Is Mono Rule.** Anything a visitor might paste (a command, a URL, an id, a path) is in JetBrains Mono.

## Layout

The docs shell (`src/components/shell/`), after the approved mock:

- **Top bar** (sticky, 60px, 24px sides; 16px on phones): the mark and wordmark (a 232px slot from `lg`, aligning with the sidebar), the ⌘K Quick Lookup (from `md`, up to 520px), Vendors and GitHub links and the service status (from `lg`), the theme toggle (from `sm`), "Get an API key" (a small primary button, 36px), and below `lg` a menu button. A bottom border; the ground is `--sb-bg` at 85% with an 8px backdrop blur.
- **Sidebar** (256px, from `lg`): sticky under the top bar, scrolling on its own, with a right border. Groups (Get started, The Index, HTTP API, MCP) under 12px semibold titles, 22px apart; items 14px, the current one on the blue tint in `--sb-accent-text`. Below `lg` its content, with the Quick Lookup, the top bar's links, the status and the theme, is a modal drawer from the left (`min(20rem, 88vw)`) over the scrim.
- **"On this page" rail** (220px, from `xl`): built from the page's `h2`s that carry an `id`, 13px, a 1px left rule per item that turns blue for the section in view.
- **The column.** Every route's main column is at most 860px (the Spec viewer's included), padded 28px top from phones and 44px from `lg`, with side gutters of 16px, 32px from `sm`, 56px from `lg`. The whole shell is at most 1440px wide, centred.
- **Rhythm.** A 4px grid; sections 40px apart; cards 16–20px inside; the Lookup box 18px (16px on phones). Anchors land below the top bar (`scroll-padding-top: 5rem`).
- **Phones.** No rails; the top bar keeps the mark, "Get an API key" and the menu. Answer cards stack; the five answers go 1, 2, then 3 across (`sm`, `lg`).

### Named Rules
**The One Column Rule.** Every page's content sits in one column of at most 860px. No page widens it.

## Elevation & Depth

Flat by default, with depth carried by surface tone and 1px edges: the ground is ink, cards one step lighter (`gray-800`), sunken wells one step darker. Shadows are few and theme-specific: in dark a 1px edge plus ambient black; in light soft navy-tinted shadows. No gradients and no textures.

### Shadow Vocabulary
- **Box lift** (`--sb-shadow-box`; dark `0 1px 0 rgb(255 255 255 / 0.03) inset, 0 20px 40px -24px rgb(0 0 0 / 0.6)`, light `0 20px 40px -24px rgb(2 28 65 / 0.35)`): the one outlined box per view (the Lookup box on Search).
- **Raised** (`--sb-shadow-md`; dark `0 0 0 1px gray-700, 0 8px 20px rgb(0 0 0 / 0.4)`, light `0 2px 4px rgb(2 28 65 / 0.06), 0 6px 16px rgb(2 28 65 / 0.08)`): a `raised` card, which trades its edge for this.
- **Overlay** (`--sb-shadow-lg`; dark `0 0 0 1px gray-600, 0 20px 44px rgb(0 0 0 / 0.55)`, light `0 4px 8px rgb(2 28 65 / 0.08), 0 18px 40px rgb(2 28 65 / 0.14)`): the menu drawer, over the scrim (`--sb-overlay`: black 65% dark, ink 60% light).

### Named Rules
**The One Lift Rule.** One box per view is lifted and outlined in blue. Everything else is flat, separated by a 1px edge.

## Shapes

The form language comes from the mark: one heavy stroke weight, a rounded head, a pill mouth, round eyes. Corners are gently rounded at four sizes: 6px (small buttons, key hints, the Copy button), 10px (buttons, inputs, sidebar items, code blocks set inside cards), 12px (content cards: answers, tables, commands), 16px (the `Card` default and the Lookup box). Pills for badges and the Try chips; circles for status dots, the service "eye", and the dot inside a status badge. Inputs and all buttons carry a 2px edge (transparent on primary and ghost); cards and tables a 1px edge; the one highlight a 2px blue edge. Icons are Lucide at its default 2px stroke with round caps, the kit's named substitute for the mark's rounded line.

## Components

The primitives are in `src/components/ui/`, each after the kit's component of the same name.

### Buttons
Compact and confident: Montserrat bold, one flat fill.
- **Shape:** gently rounded (10px; 6px at `sm`), 2px edge.
- **Primary:** SwaggerBot Blue fill, navy text; 32 / 40 / 48px tall (13 / 14 / 16px text, 12 / 16 / 24px sides). One per view: "Look up" on Search, "Get an API key" in the top bar.
- **Hover / Focus / Press:** hover one ramp step lighter (`blue-400`), press `blue-300` and a 1px nudge down, 150ms on `--sb-ease-out`; focus the 2px blue outline at 2px offset; disabled 45% opacity.
- **Secondary:** transparent with a 2px `--sb-border-strong` edge and full-strength text; the edge turns blue and the text `--sb-accent-text` on hover. For "Read the docs", pagination.
- **Ghost:** transparent, `--sb-accent-text`, the blue tint on hover. For a quieter onward link ("Request a key").
- `buttonClass` styles a link as a button (and opts it out of the underline).

### Badges
- **Style:** a 22px pill in Montserrat 700 capitals, 11px. Tones: accent (blue tint), neutral, success, warning, danger (each on its soft ground in its text colour), outline (1.5px `--sb-border-strong` edge, muted text). `dot` adds the round status eye.
- **AnswerBadge:** the five answers in the Five Colours Rule, always with the answer's name written (short forms Unconf., Ambig. as `abbr`). **ProvenanceBadge:** Official (accent, with the eye), Endorsed (neutral), Mirror (outline), Community (dashed outline).
- **MethodBadge:** an HTTP method in mono, 5px radius: GET on the blue tint, POST on a 16% periwinkle tint in `code-keyword` (dark) or `method-post-light` (light).

### Chips
- **Style:** the Try chips under the Lookup box: pill links, 1px `--sb-border` edge, 13px Plex in full text, 10px sides, no underline.
- **State:** the edge turns blue and the text `--sb-accent-text` on hover. Each chip is a link to that Lookup.

### Cards / Containers
- **Corner Style:** 16px for `Card` and the Lookup box; 12px for content cards (the answer cards, tables, command cards).
- **Background:** `--sb-surface`.
- **Shadow Strategy:** none by default; `outline` adds the box lift; `raised` swaps the edge for the raised shadow (see Elevation & Depth).
- **Border:** 1px `--sb-border`; `outline` is 2px SwaggerBot Blue, once per view.
- **Internal Padding:** 16–20px; tables and tabbed cards run edge to edge with 16px cell padding and a `--sb-bg-subtle` header row.

### Inputs / Fields
- **Style:** 40px (48px in the Lookup box, 16px text), 2px `--sb-border` edge, 10px radius, the page ground (`--sb-bg`) inside, faint placeholder. `mono` for URLs and ids.
- **Focus:** the edge turns blue, plus the 2px focus outline. Hover strengthens the edge.
- **Disabled:** sunken ground, faint text.
- The Quick Lookup in the top bar is a 38px field on `--sb-bg-subtle` with a 1px edge, a search icon and a ⌘K key hint.
- Checkboxes are native, 16px, with the blue accent (the kit's Checkbox is not built).

### Navigation
- **Sidebar:** 14px Plex; items muted, full text and a half-strength blue tint on hover; the current item (`aria-current="page"`) on the blue tint in `--sb-accent-text`, medium weight; no underlines. HTTP API links carry their MethodBadge.
- **Top bar links:** 14px medium, muted, full text on hover, no underline.
- **On this page:** 13px, muted, a 1px left rule per entry; the section in view gets a blue rule and full text.
- **Tabs:** the WAI-ARIA tabs pattern (arrow keys, Home, End). Plex 13px medium, muted; the selected tab in full text with a 2px inset blue underline. Without script the first panel shows.

### Code Block (signature)
The artefact is always one step away. Code on the ink ground in both themes (`--sb-code-bg`, `--sb-code-text`), JetBrains Mono 12.5px on 1.7, wrapping unless told to scroll, with a labelled Copy button (28px, 1px translucent white edge, Lucide copy/check icon) and a polite live region that says when it copied. The command word is picked out in `code-keyword`.
- **SpecDownloadCurl** shows a Spec's download command elided (`CodeBlock`'s `elided`): `curl -o openapi.yaml …/specs/1fdc1047…78a9/published`, the origin elided and the Spec id shortened and picked out in `blue-300`. From `sm` up it stays on one line; on a phone it wraps at the normal 12.5px, with the same labelled Copy button. Copy copies, and screen readers read, the whole real command.

### Path
URLs and paths shown as text (outside code blocks: the Sources lists, the docs routes) go through `Path` (`src/components/ui/path.tsx`), which lets a long one break only after a `/` (never inside `//`) or before `?`, `&` or `[`, and never in the middle of a word.

### Answer card (signature)
An answer is a content card: a header row (the API name as a title link, its AnswerBadge, its Provenance, the time it took in 13px muted, pushed right from `sm`), then tabs (curl, MCP, JSON) over code blocks. A Lookup states its answer once: the page heading names it and the card carries the badge.

### Status eye
An 8px round dot for the service status in the top bar: an empty `--sb-border-strong` ring while checking, green when the service answers, red when it doesn't. The state is always written beside it ("Operational", "Not answering"). A status badge's `dot` is the same eye in the badge's own colour.

## Do's and Don'ts

### Do:
- **Do** use the `--sb-*` tokens (as `bg-sb-*`, `text-sb-*`, `border-sb-*`, or the shadcn names mapped onto them) in components, never raw hex.
- **Do** keep every page in the one 860px column inside the docs shell.
- **Do** write the answer's name on every AnswerBadge, and the Provenance on every Spec, so colour is never the only signal.
- **Do** show a Spec's download command with `SpecDownloadCurl`: the id elided, one line from `sm`, the whole URL on Copy; and a URL or path shown as text with `Path`, so it breaks only at its separators.
- **Do** check every page in both themes at phone and desktop widths (`scripts/uicheck.ts`).
- **Do** use the logos as supplied (`public/brand/`), never redrawn or recoloured.
- **Do** build a missing control (Select, Switch, Dialog, Toast, Tooltip) from the kit's component when a screen first needs it, with the adaptations above.

### Don't:
- **Don't** put white text on the blue fill.
- **Don't** fill passive surfaces with blue, or outline more than one box per view.
- **Don't** put a kicker or eyebrow above a page title; BETTER THAN SPECS on Search is the only line there.
- **Don't** use raw `swaggerbot-blue` for body-size text; use `--sb-accent-text`.
- **Don't** invent answer states or colours beyond the five.
- **Don't** add gradients, textures, glassmorphism or a second blur; the top bar's is the only one.
- **Don't** load fonts from a CDN; the CSP allows `font-src 'self'` only.
- **Don't** bring back anything from the retired themes (the interim navy page, Darkroom Safelight's amber); `PRODUCT.md` retired them.
