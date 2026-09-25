---
name: SwaggerBot
description: A working darkroom where the name of an API is developed into a verified Spec, printed with its Provenance.
colors:
  lamp: "#ffb000"
  bay: "#e8a33d"
  bay-deep: "#dc9530"
  ink: "#0e0e0e"
  ink-2: "#3a2206"
  rule: "#4b2e07"
  destructive: "#7a1408"
  bay-dark: "#140b03"
  bay-deep-dark: "#21140a"
  ink-dark: "#ffb000"
  ink-2-dark: "#c58b35"
  rule-dark: "#6b4a1c"
  destructive-dark: "#ff7a5c"
  tray-edge-dark: "#9a6400"
  print: "#f6f1e6"
  print-dark: "#e9e2d2"
  print-ink: "#0e0e0e"
  print-ink-2: "#5a554c"
  strip-1: "#f6f1e6"
  strip-2: "#c9c4b8"
  strip-3: "#8c8c8c"
  strip-4: "#3a3a3a"
  strip-5: "#0e0e0e"
  stale-wash: "#a39c8f"
typography:
  display:
    fontFamily: "Permanent Marker, Barlow Condensed, cursive"
    fontSize: "clamp(3.25rem, 8.5vw, 6rem)"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "normal"
  headline:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.025em"
  title:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.025em"
  body-lead:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.625
  body:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.375
    fontFeature: "\"tnum\""
  label:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.14em"
  label-sm:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.12em"
  numeral:
    fontFamily: "DSEG7 Classic, JetBrains Mono, ui-monospace, monospace"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1
  data:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
rounded:
  none: "0px"
  mark: "2px"
  control: "3px"
  tile: "7px"
  lamp: "9999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  gutter: "16px"
  gutter-wide: "32px"
  section: "40px"
  section-wide: "56px"
  rail: "16rem"
components:
  button-primary:
    backgroundColor: "{colors.lamp}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 28px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.strip-5}"
    textColor: "{colors.lamp}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.control}"
    padding: "4px 12px"
  input-search:
    backgroundColor: "{colors.print}"
    textColor: "{colors.print-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "48px"
  nav-drawer:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  print:
    backgroundColor: "{colors.print}"
    textColor: "{colors.print-ink}"
    rounded: "{rounded.control}"
    padding: "12px"
  print-image:
    backgroundColor: "{colors.strip-5}"
    textColor: "{colors.print}"
    rounded: "{rounded.mark}"
    padding: "12px 16px"
  print-image-stale:
    backgroundColor: "{colors.stale-wash}"
    textColor: "{colors.print-ink}"
    rounded: "{rounded.mark}"
    padding: "12px 16px"
  provenance-mark:
    textColor: "{colors.print-ink}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.mark}"
    padding: "1px 6px"
  station:
    backgroundColor: "{colors.bay}"
    textColor: "{colors.ink}"
    padding: "16px"
  station-lit:
    backgroundColor: "{colors.lamp}"
    textColor: "{colors.ink}"
    padding: "16px"
  certainty-cell:
    backgroundColor: "{colors.bay-deep}"
    textColor: "{colors.ink}"
    typography: "{typography.label-sm}"
    padding: "4px"
  code-line:
    backgroundColor: "{colors.strip-5}"
    textColor: "{colors.print}"
    typography: "{typography.data}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: SwaggerBot

## Overview

**Creative North Star: "The Safelight Bay"**

A Spec is developed, not fetched. Every screen is a room in a working darkroom: the page is the bay under safelight amber, a typed name is exposed and developed through the real Source chain, and the answer comes out as a fixed print on enamel-white stock with its Provenance and `verifiedAt` written on the label. Light theme is the lit bay (amber owns every region, dense-black ink, deeproom-brown rules). Dark theme is the same bay with the light off (deeproom brown and dense black, amber as the ink). The theme follows `prefers-color-scheme`; there is no toggle.

The world is dense, instrument-like and honest. Labels are condensed caps stencilled on equipment, counts and times read on seven-segment displays, identifiers are monospaced batch marks, and a few human words are written in grease pencil. Nothing is decorated for its own sake: every tone on the silver test strip means something (how sure an answer is, or how recently a Spec was verified), and every station, print and stamp shows a real fact from the Index. The refused category default is a centred search box beside a code sample over a route table.

Tailwind v4 carries the tokens as custom properties in `src/styles/app.css`, and shadcn's token names (`background`, `card`, `primary`, `secondary`, `ring`...) are remapped onto the darkroom palette, so shadcn primitives restyle into the world when added. Faces are self-hosted in `src/styles/fonts.css` (CSP allows `font-src 'self'` only).

**Key Characteristics:**
- Amber owns every region; the only neutral ladder is the silver test strip, and it always means certainty or recency.
- Enamel white appears only on prints (Spec cards) and on inputs that receive a name to develop.
- Five type roles with fixed jobs: grease pencil, instrument caps, body, seven-segment numerals, mono data.
- Bordered, squared controls; one amber tray-edge primary per view; black secondaries.
- One motion: a print developing out of the paper. Still under reduced motion.
- Everything shown is live Index data or a dated Benchmark figure; nothing invented.

## Colors

A monochrome amber room with one silver-to-black ladder and one enamel stock; there is no second hue.

### Primary
- **Safelight Amber** (lamp): the lamp itself, identical in both themes. Fills the primary tray-edge button, the lit (current) station, the Copy button, the health lamp's glow, and is the ink of the dark theme. Text on it is always dense black.

### Neutral (the bay)
- **Lit Bay** (bay / bay-dark): the page ground. Light: warm safelight orange. Dark: near-black deeproom brown.
- **Deep Bay** (bay-deep / bay-deep-dark): the recessed surfaces: the rail, the status band, certainty-strip label cells. Also `theme-color`.
- **Dense Black Ink** (ink / ink-dark): all text and focus rings on the bay. In dark it becomes Safelight Amber.
- **Deeproom Brown Ink** (ink-2 / ink-2-dark): secondary text on the bay (sublines, captions, small label-caps headings such as "Last verified", "Not needed").
- **Deeproom Rule** (rule / rule-dark): 1px rules and structural borders: rail edge, station grid gaps, strip outline, footer rule.
- **Stop Red** (destructive / destructive-dark): only the health lamp when the service isn't answering, and errors.
- **Tray Edge, dark** (tray-edge-dark): the primary button's heavy bottom edge in the dark theme only (light uses dense black).

### Tertiary (prints and the test strip)
- **Enamel** (print / print-dark): print stock. Also the search inputs, because they are where the exposure starts. The dark print is slightly dimmed so it does not glare.
- **Print Ink / Print Ink 2** (print-ink, print-ink-2): text on enamel; print-ink-2 for field labels, placeholders and Stale stamps on a print.
- **Silver Test Strip** (strip-1 enamel → strip-2 silver → strip-3 darkroom grey → strip-4 → strip-5 dense black): the only tonal ladder. See the rule below.
- **Stale Wash** (stale-wash): a warm washed silver used only for a Stale print's image; deliberately not a strip step.

### Named Rules

**The Enamel Rule.** Enamel white is reserved for prints (Spec cards) and name inputs. No panels, modals, tables or page regions in enamel; a shadcn `card` or `popover` is a print and must behave like one (a Spec's facts, on stock).

**The One Ladder Rule.** The silver test strip is the only greyscale, and every use of it encodes a fact. It carries two scales, never mixed in one element: **certainty** (Outcome: Resolved strip-5, Unconfirmed strip-4, Ambiguous strip-3, No Spec strip-2, Unknown an empty cell showing the bay) and **recency** (a print's image: newest strip-5, then strip-4, then strip-3). **Stale** is not a step on either scale: it is the separate Stale Wash tone plus the words "· Stale". Never use a strip tone as decoration or a generic grey.

**The Lamp Rule.** Amber fill means "this is live or this is the action": the one primary button, the station a Lookup is at, Copy, the health lamp. Don't fill passive surfaces with Safelight Amber.

## Typography

**Display Font:** Permanent Marker (with Barlow Condensed, cursive)
**Label Font:** Barlow Condensed (500/600/700)
**Body Font:** Barlow (400/500/600)
**Numerals:** DSEG7 Classic (700, with JetBrains Mono)
**Data Font:** JetBrains Mono (400–700)

**Character:** Grease pencil on the darkroom wall, stencilled equipment caps, and meter read-outs, over a plain, readable sans for sentences.

### Hierarchy
- **Display** (Permanent Marker 400, clamp(3.25rem, 8.5vw, 6rem), line-height 0.95, uppercase): one to three human words, once per screen, top-left (“No fake Specs.”). Tailwind `font-pencil`.
- **Headline** (Barlow Condensed 600, 1.5rem, uppercase, 0.025em): section headings (“How a Spec is developed”) and a print's API name. `font-caps`/`font-heading`.
- **Title** (Barlow Condensed 600, 1.125rem, uppercase, 0.025em): station names, the rail's last-verified API name (1.125rem).
- **Body lead** (Barlow 400, 1.125–1.25rem, line-height 1.625, ink-2, max 34rem): the one subline under the display.
- **Body** (Barlow 400, 0.875rem, tabular numerals globally): notes, captions, footer, dd values, dates.
- **Label** (Barlow Condensed 600, 0.75–0.875rem, uppercase, 0.12–0.14em): field labels, nav, button text, figcaptions, dt terms, provenance marks, “Answered here / Not needed”.
- **Numeral** (DSEG7 Classic 700: 2.25rem on prints, 1.5–1.875rem for Index counts, 0.875rem for station numbers): counts, times, sizes only. Units sit beside it in label caps (“ms”).
- **Data** (JetBrains Mono, 0.75–0.875rem): Spec ids, URLs, commands, anything copyable. Wrap with `overflow-wrap: anywhere`.

### Named Rules

**The Grease Pencil Rule.** Permanent Marker is for one to three human words, in caps, at display size, at most once per view. Never for labels, data, buttons, body or numbers. *Decision (Wes, 2026-09-25):* Permanent Marker is accepted as the display face after the finish review scored it partial; no self-hostable open face carries real wax grain, and faking grain with an SVG filter is refused. It is preloaded in `__root.tsx`.

**The Instrument Rule.** Every label is condensed caps with open tracking (0.12–0.14em); sentences are never set in caps. Every count, time or size is seven-segment; every id, URL or command is mono. Dates are body text (`24 Sept 2026`, UTC, en-GB).

## Layout

- **Shell:** at `lg` (1024px) and up, a sticky full-height left rail (16rem, bay-deep, rule on the right) beside the page; below `lg` the rail collapses into a top bar (mark, nav, health lamp) with a bottom rule. The rail holds, top to bottom: mark + wordmark, nav drawers, “Last verified” (API name, Provenance mark, stamp), “In the Index” counts (Vendors, APIs, Specs as seven-segment), and the health lamp pinned to the bottom. Sections inside the rail are separated by a rule and 20px.
- **Page field:** gutters 16px, 32px from `sm` (640px); top padding 32px, 48px from `lg`; section gaps 40px, 56px from `lg`. Main content is left-aligned, not centred. At `xl` (1280px) the first band splits ~1.15fr / 0.85fr (min 20rem) between the working area and the print; below that it stacks.
- **Grids of stations:** 2 columns on phones, 3 from `sm`, 6 from `xl`, separated by 1px rule gaps (the grid background shows through). No horizontal scroll at 390px.
- **Status band:** full-bleed bay-deep band with a top rule at the foot of the page field (Benchmark with base and date, the copyable MCP line; Index counts appear here only below `lg`, where the rail doesn't show them).
- **Measure:** prose max ~34rem; forms max 40rem.
- The `/embed/…` routes render without the shell.

## Elevation & Depth

Mostly flat, depth by tone: the bay is the room, bay-deep is the recessed bench, and prints are the only objects that lift off it.

### Shadow Vocabulary
- **Print lift** (`box-shadow: 0 6px 18px -6px rgb(0 0 0 / 0.45)`): only on a print. It is a sheet lying on the bench.
- **Lamp glow** (`box-shadow: 0 0 8px 1px var(--lamp)`): only on a lit lamp (the health lamp when up).
- **Tray edge** (a 5px bottom border, not a shadow): the primary button's pressable depth; it compresses to 2px and moves down 3px on `:active`.

### Named Rules

**The Only-Prints-Lift Rule.** No shadows on panels, stations, strips, nav or dialogs. If something needs to feel raised, it is either a print or a tray-edge control.

## Shapes

Squared and machined. Controls and prints have a barely-softened 3px corner; small marks and inner image fields 2px; the primary tray-edge button is square (0). The bot mark's tile is the one soft shape (7px on 32). The only full circle is the health lamp. Borders are real lines: 1px rules for structure, 2px dense-black for the name input and the primary button. shadcn's `--radius` (4px scale) is defined but the build uses the 2px/3px/0 values above; new components should match the build.

Provenance is drawn as line weight, strongest to weakest: **Official** 2px solid, **Endorsed** 1px solid, **Mirror** 1px dashed, **Community** 1px dotted, all in `currentColor`.

## Components

### Buttons
- **Primary: the tray edge.** Safelight Amber fill, dense-black text (#0e0e0e in both themes), label caps 700 at 1.125rem with 0.14em tracking, 48px min height, 28px side padding, square corners, 2px dense-black border with a 5px bottom edge (dark: tray-edge-dark). `:active` presses in (translateY 3px, bottom edge 2px, 100ms). Hover brightens 5%. One per view (“Develop”).
- **Secondary: black.** Dense-black fill (#0e0e0e in both themes), Safelight Amber label caps (0.75rem, 0.12em), 3px corner, 1px ink border, 4px 12px padding; hover brightens 125%. Used for Pause/Play and similar utility actions.
- **Attached action:** Copy on the code line is an amber cell joined to it by a 1px ink rule.
- **Focus:** global 2px outline in `--ring` (dense black in light, amber in dark), 3px offset. Never remove it.

### Inputs / Fields
- **Name input:** enamel fill, print-ink text, print-ink-2 placeholder with real example names, 2px ink border, 3px corner, 48px tall, 1.125rem text. Label above in label caps (“The name of an API”). Paired with the primary to its right (stacked full-width on phones).
- **Secondary fields** (inside “Options” disclosure): same stock, 1px ink border, 40px. Checkboxes take `accent-color: var(--ink)`. Optional marks in lower-case ink-2.

### Navigation (the drawers)
Label caps 600, 1rem, 0.14em, 6px 12px padding, 3px corner, transparent 1px border; hover shows a rule border, the active route a dense ink border. Vertical in the rail, horizontal in the mobile bar. Each new screen adds one line to `src/components/shell/nav.ts`.

### Print (signature)
A Spec on enamel: 12px padding, 3px corner, print lift. Top is the **image**: a density field (min 128px, 2px corner) whose tone is recency (strip-5/4/3, or Stale Wash) and which carries one measured fact in seven-segment (“Answered in 0.6 ms”). Below, the label: API name as headline, then a two-column `dl` (label-caps terms in print-ink-2, values right-aligned): Vendor, Provenance (mark, or “None confirmed”), Verified (stamp), Spec (mono batch mark, first 12 chars). Heading level is a prop. The image develops with the one motion when the print changes. For the Lookup result, scale follows certainty per the direction contract (not yet built): a Resolved print lands large; Unconfirmed and Ambiguous smaller and quieter.

### Provenance mark
An outlined label-caps tag (0.75rem, 0.12em, 1px 6px, 2px corner) in `currentColor`, the tier drawn by line style (see Shapes). Works on the bay and on enamel. Always the glossary tier name.

### Verified stamp
`verifiedAt` as a `<time>` in body text, `DD Mon YYYY` UTC. A Stale entry adds “· Stale” and drops to the secondary ink of its surface (`on="print"` print-ink-2, `on="bay"` ink-2). Missing: “Not verified”.

### Stations (the Source chain)
Numbered cells (01–06: Index, APIs.guru, Developer Portal, Vendor domain, GitHub, Judged) in a rule-gapped grid. Each: seven-segment number, title-caps name, a one-line ink-2 note, 16px padding. The station a Lookup is at is lit (amber fill, dense black text, #3a2206 note, `aria-current="step"`, 500ms colour transition). After the Index answers, 01 shows a black “Answered here” tag and 02–06 say “Not needed”. Show only the path actually taken.

### Certainty strip
The Outcome scale as a five-cell strip with a 1px rule outline and 2px corner: a 16px swatch per Outcome (strip-5 → strip-2, Unknown empty) over a bay-deep label cell in label caps, with a caption. It is the legend for every certainty encoding; the Lookup result's one-view-per-Outcome must use the same tones.

### Code line
Dense-black (strip-5) field, enamel mono text, 1px ink border, 3px corner, 10px 12px padding, with the attached amber Copy; a polite live region announces “Copied”.

### Health lamp and bot mark
The lamp is a 10px circle with a rule border: amber with glow when up, Stop Red when down, empty while checking; its sentence is the accessible label (`aria-live="polite"`). The bot mark (binding) is the existing drawing in amber strokes on a dense-black 7px-radius tile, same as `public/favicon.svg`.

### Motion
One motion only: **print-develop**, 2.4s `cubic-bezier(0.16, 1, 0.3, 1)`, opacity 0.06 → 0.7 → 1 with blur 4px → 1px → 0, on a print's image when it changes. Supporting micro-transitions: station light 500ms colours, tray-edge press 100ms. Under `prefers-reduced-motion: reduce` the develop animation is off and attract-mode replay does not run (prints are shown developed). Any auto-advancing replay is labelled as a replay, stops for good when the visitor types, pauses on hover and focus, and has its own Pause control.

## Do's and Don'ts

### Do:
- **Do** use the shadcn token names (`bg-background`, `bg-card`, `text-primary-foreground`, `ring`) and the darkroom utilities (`bg-bay-deep`, `text-ink-2`, `bg-print`, `bg-strip-N`, `border-rule`, `font-caps`, `font-segment`, `font-pencil`) rather than new hex values.
- **Do** keep text pairs to the measured passing set: ink on bay (8.95:1 light, 10.62:1 dark), ink-2 on bay (6.9:1 / 6.6:1), ink-2 on bay-deep (5.94:1 / 6.09:1), dense black on lamp (10.54:1), print-ink on print (17.14:1 / 14.96:1), print-ink-2 on print (6.57:1 / 5.73:1), enamel on strip-5 (17.14:1) and strip-4 (10.1:1), dense black on strip-3 (5.74:1) and Stale Wash (7.09:1), Stop Red on bay (5.04:1 / 7.59:1).
- **Do** put text on Safelight Amber in literal dense black (#0e0e0e), because `--ink` becomes amber in the dark theme.
- **Do** give every Spec its Provenance mark, stamp and mono Spec id on the print itself, not behind a click.
- **Do** express certainty with the strip tones and scale (Resolved densest and largest), and say the Outcome's name in words next to it.
- **Do** label every figure with its base and date (Benchmark) or read it live (Index counts).
- **Do** frame the sandboxed Scalar viewer as a print: enamel frame, Provenance, `verifiedAt`, Published/Normalized switch, Alternates, Validity Issues and downloads on the label, and never let it restyle the shell.
- **Do** keep every screen keyboard-complete, with the skip link and the visible 2px focus ring.

### Don't:
- **Don't** use enamel white for anything but prints and name inputs.
- **Don't** use strip tones as generic greys, and don't mix the certainty and recency scales in one element; don't show Stale as a strip step.
- **Don't** introduce a second accent hue, gradients, or glass/blur surfaces.
- **Don't** set more than three words in Permanent Marker, or use it more than once per view, or for anything but a display line.
- **Don't** use seven-segment for anything but numbers, or mono for anything but data.
- **Don't** add shadows to anything but a print (lift) or a lit lamp (glow).
- **Don't** put more than one amber tray-edge primary in a view.
- **Don't** add animation beyond print-develop and the two micro-transitions, and don't run any of them under reduced motion.
- **Don't** show a station, Source or path the Lookup didn't take, or any invented count, customer or testimonial.
- **Don't** render any Spec content as live HTML outside the sandboxed frame.
- **Don't** use rule-coloured borders as the only indicator of an interactive control in the dark theme (rule-dark on bay-dark is 2.43:1); interactive borders use ink.
