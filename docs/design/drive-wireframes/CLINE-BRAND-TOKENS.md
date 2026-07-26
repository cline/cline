# Cline brand tokens

Extracted from the live site on 2026-07-25 via Chrome DevTools Protocol against
`https://cline.bot`, `https://cline.bot/cli`, and `https://cline.bot/brand`.
Values below are read from the `:root` custom properties and from
`getComputedStyle` on real rendered elements, not eyeballed from a screenshot.

The Drive wireframes in this folder consume these tokens. The canvas at
`~/.cursor/projects/<workspace>/canvases/cline-drivecode-overview.canvas.tsx`
does **not**: canvas rules forbid hardcoded hex and require `useHostTheme()`.
There, Cline brand maps onto host theme accent and stroke tokens instead.

## Core palette (`:root` custom properties)

These are declared by the site itself as `--brand-*`, in `R,G,B` triplet form.

| Token | RGB triplet | Hex | Use |
|---|---|---|---|
| `--brand-purple` | `159,88,250` | `#9F58FA` | The Cline accent. Headlines, primary buttons, active state, links |
| `--brand-black` | `21,21,22` | `#151516` | Light-theme text, dark chrome |
| `--brand-white` | `248,250,251` | `#F8FAFB` | Light-theme page background |
| `--brand-green` | `43,204,40` | `#2BCC28` | Success, live, "running" |
| `--brand-pink` | `245,57,105` | `#F53969` | Alert, destructive, leave |
| `--brand-blue` | `84,135,200` | `#5487C8` | Informational, secondary data |

### Purple tints actually used in dark mode

The site does not use flat `#9F58FA` on dark backgrounds. It shifts lighter
for text-on-dark and slightly cooler for borders.

| Hex | Where it appears |
|---|---|
| `#9F58FA` | Base accent, fills, `dark:text-[#9F58FA]` |
| `#9663F1` | `dark:border-[#9663f1]`, `dark:hover:text-[#9663f1]` |
| `#B48CF7` | `dark:hover:text-[#b48cf7]` |
| `#B87FFF` | `dark:text-[#b87fff]` |
| `#B98AFF` | `dark:text-[#B98AFF]` — lightest, for body copy on near-black |

Rule of thumb from the site. Fills use `#9F58FA`. Text on dark uses
`#B98AFF` or `#B87FFF`. Borders on dark use `#9663F1`.

## Surfaces

### Dark (the mode the Drive wireframes use)

Measured from `document.body` and the highest-frequency background colors with
`.dark` applied.

| Hex | RGB | Role |
|---|---|---|
| `#0A0A0A` | `10,10,10` | Page background (`body`) |
| `#08080A` | `8,8,10` | Deepest well, inset areas |
| `#0D0D10` | `13,13,16` | Raised card surface (most common card bg) |
| `#101013` | `16,16,19` | Secondary panel |
| `#12131A` | `18,19,26` | Elevated panel with a cool cast |
| `#171923` | `23,25,35` | Slate-tinted section |
| `#1B1D24` | `27,29,36` | Terminal / code card (`.cli-command-card`) |
| `#2A2A2A` | `42,42,42` | Hover fill on neutral controls |

Navigation bar is `rgba(10,10,10,0.95)` with `backdrop-filter: blur(4px)`.

### Light

| Hex | Role |
|---|---|
| `#F8FAFB` | Page background |
| `#FFFFFF` | Card surface |
| `rgba(240,240,240,0.3)` | Subtle section fill |
| `rgba(21,21,22,0.035)` / `0.05` | Tinted wells |

## Text

| Hex | RGB | Role (dark) |
|---|---|---|
| `#FFFFFF` | `255,255,255` | Primary |
| `#D1D5DB` | `209,213,219` | Code / command text |
| `#9CA3AF` | `156,163,175` | Secondary body copy |
| `#6B7280` | `107,114,128` | Tertiary, captions, inline command hints |

In light mode body copy is `rgba(21,21,22,0.78)`, not solid black.

## Borders

Cline uses **hairline `0.8px`** borders, not `1px`, and expresses them as low
alpha over the surface rather than as a solid gray.

| Value | Frequency | Role |
|---|---|---|
| `0.8px rgba(255,255,255,0.10)` | most common in dark | Standard card / panel stroke |
| `0.8px rgba(255,255,255,0.05)` | | Nav underline, faintest divider |
| `0.8px rgba(255,255,255,0.08)` | | Inner divider |
| `0.8px rgba(255,255,255,0.20)` | | Emphasis / hover stroke |
| `0.8px rgba(51,65,85,0.80)` | | Slate-tinted panel stroke |
| `0.8px rgba(75,85,99,0.95)` | | Terminal card stroke |
| `0.8px rgba(21,21,22,0.06 / 0.08 / 0.10)` | light mode | Same ladder inverted |

## Radius

Sampled across ~800 elements. `9px` dominates by a wide margin.

| Value | Count | Role |
|---|---|---|
| `9px` | 62 | Default. Buttons, inputs, nav items, most containers |
| `13.5px` | | Feature cards |
| `14px` | | Terminal / command card |
| `8px` | 6 | Smaller containers |
| `9999px` | 3 | Eyebrow pills, badges |
| `2.25px` | 8 | Micro chips, tags |

## Typography

Three families, each with a distinct job. All are Google Fonts.

| Family | Role | Evidence |
|---|---|---|
| **DM Sans** | Marketing display. Site `h1`, hero copy | `--font-geist-sans`, `--font-blog-sans`, `body` |
| **Inter** | Product UI. Nav, buttons, body paragraphs, `h2` | Computed on nav links, `p`, `h2` |
| **Space Grotesk** | Code, terminal, section headings, product headlines | `--font-geist-mono`; computed on `h3`, `code`, `pre` |

Cline aliases its *mono* slot to Space Grotesk, which is a proportional
grotesque, not a true monospace. For the Drive wireframes we keep Space
Grotesk for labels, eyebrows, and headings, and fall back to a real monospace
for aligned code columns where character alignment actually matters.

### The shipped product disagrees with the site

The table above is measured off cline.bot. The hub webview sets
`--font-sans: "Schibsted Grotesk Variable"`
(`apps/cline-hub/src/webview/src/index.css`), so the UI users actually touch is
Schibsted Grotesk, not Inter. Wireframes that mock **product chrome** use
Schibsted Grotesk for UI text and keep DM Sans for display and Space Grotesk
for eyebrows; wireframes that mock the **site** should use Inter. Product
fidelity wins where the two conflict.

### Measured type scale

| Element | Family | Size | Weight | Letter-spacing |
|---|---|---|---|---|
| Home `h1` | DM Sans | 72px | 400 | `-1.44px` (≈ `-0.02em`) |
| CLI page `h1` | Space Grotesk | 64px | 700 | `-1.6px` (≈ `-0.025em`) |
| `h2` | Inter | 24px | 300 | normal |
| `h3` | Space Grotesk | 20px | 700 | normal |
| Body `p` | Inter | 18px | 400 | normal |
| Terminal command | Space Grotesk | 22.5px | 400 | normal |
| Inline command hint | Space Grotesk | 11.5px | 400 | normal |

Display headings are **negatively tracked**. Eyebrow badges are the opposite:
uppercase, small, and positively tracked.

## Signature components worth mirroring

**Terminal card.** `#1B1D24` background, `14px` radius, `0.8px
rgba(75,85,99,0.95)` stroke, `$` prompt glyph in `#4ADE80`, command text in
`#D1D5DB` Space Grotesk. This is the single most recognizable Cline surface
and the direct model for the Drive stage.

**Eyebrow badge.** Pill (`9999px`), uppercase Space Grotesk, small, letter-
spaced, separated by `·`. Example from the CLI page: `OPEN SOURCE · CLI ·
KANBAN · ACP`. Reused in the wireframes for section labels.

**Green prompt.** `#4ADE80` (Tailwind `green-400`) for the shell `$` and live
indicators. Slightly lighter than the declared `--brand-green` `#2BCC28`,
which is reserved for marketing marks.

## Motion

| Token | Value |
|---|---|
| `--ease-out-soft` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--ease-in-out-soft` | `cubic-bezier(0.65, 0, 0.35, 1)` |
| `--transition-fast` | `150ms` |
| `--transition-medium` | `300ms` |
| `--transition-slow` | `700ms` |

## What NOT to copy

- **Discord blurple `#5865F2`.** The previous Drive tab prototype defaulted to
  it along with Discord's `#2B2D31` / `#313338` surface ladder. We steal
  Discord's *information architecture*, never its palette. Cline purple
  `#9F58FA` is warmer, more saturated, and reads violet rather than indigo.
  Putting them side by side is the clearest tell that a mock is unbranded.
- **Discord's status colors.** `#23A55A` green, `#F23F43` red, `#EB459E` pink.
  Use `#2BCC28` / `#4ADE80`, `#F53969`, and `#9F58FA` instead.
- **Gradients on text.** The site uses flat purple on headlines. No
  `background-clip: text`.
- **Heavy shadows.** Cline is flat. Depth comes from the surface ladder
  (`#0A0A0A` → `#0D0D10` → `#12131A` → `#1B1D24`) and hairline strokes, not
  from `box-shadow`.
- **1px borders.** The hairline is `0.8px`. At `1px` the chrome reads heavier
  than the real product.
- **Purple everywhere.** On the real site the accent appears on headlines, the
  primary CTA, and active state. Everything else is neutral. Rainbow-coloring
  a mock in brand purple is the fastest way to look off-brand.

## Consumers in this folder

| File | Uses |
|---|---|
| [drive-tab-discord-slack.html](drive-tab-discord-slack.html) | Full token set as CSS custom properties, both accent variants |
| [index.html](index.html) | Surface ladder, accent, type stack |
