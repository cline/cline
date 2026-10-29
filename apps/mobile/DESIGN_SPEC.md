# Cline — Mobile Design Spec

A concrete, React-Native-buildable spec reverse-engineered from the real desktop
Cline UI (`apps/examples/desktop-app/webview`) and the `@cline/ui` package
(`sdk/packages/ui`). Every value below is pulled from source, not eyeballed.

## Mobile product hierarchy

Desktop visual language does not imply desktop information architecture. Once
configured, mobile leads with “What would you like to build?” and a live Home
composer. Before that, it presents a focused setup flow. Mobile therefore:

- presents one new-conversation Home. **Cline Cloud** configurations and paired
  computers are execution targets for the same composer, not competing
  destinations; recent sessions live in a history sheet, the phone counterpart
  to desktop's persistent sidebar;
- treats the **Cline Account** as identity and Cloud-session source. Account
  actions never change how a Cloud or computer-backed session is opened;
- does not treat account authentication as authority over a laptop: each phone
  still completes the secure QR pairing ceremony before controlling a computer;
- keeps configured Home chrome to the Cline mark, session history, and Settings;
  Cloud setup and QR pairing remain in the dedicated setup flow and Settings;
- labels a legacy endpoint as a **paired computer** until the hub can provide real
  session metadata; it must not manufacture a fake “Latest session” identity;
- keeps raw URLs/tokens in Settings → Connections → Advanced only;
- exposes a real composer on Home only when at least one runnable target exists.
  Sending starts a fresh inner Cline session on the selected local target or
  provisions a Cloud workspace from its saved repository/model configuration.
  Inert model selectors and placeholder promises for `/` or `@` are prohibited.

All colors reference the RN token set in
`apps/mobile/src/theme/tokens.ts` (`darkTokens` — the app is dark-forced, exactly
like desktop, whose `<html>` is hard-coded `className="dark"`). Token names used
throughout: `brand500 brand600 canvas surface surfaceRaised surfaceMuted text
textMuted border focus danger onBrand`, radii `sm/md/lg`, fonts `sans/mono`.

---

## ⚠️ Read first: the accent-color divergence (biggest translation gap)

The desktop app does **not** render with the green Cline brand. The ported RN
`tokens.ts` came from `@cline/design-tokens` (a **green** brand: `brand500
#58c69b`, neutral near-black surfaces). But the desktop webview actually themes
itself through `@cline/ui/theme` (`sdk/packages/ui/theme/tokens.css`), whose
`--primary` is **violet**, on **cool purple-tinted** dark surfaces. Every
interactive accent on desktop — tool-activity labels, the send button, focus
rings, the aurora, the hero heading gradient — is violet, not green.

If the mobile app uses `brand500` (green) for `--primary`, it will not look like
Cline. **Recommendation:** add a violet accent + the aurora artwork family
to the RN token set and treat that as the primary accent. Concrete values below.

### Desktop `@cline/ui` dark theme → RN token mapping

| Desktop semantic (`tokens.css` `.dark`) | oklch source | approx hex | RN token to use |
|---|---|---|---|
| `--background` | `oklch(0.17 0.012 285)` | `#1b1a1f` | `canvas` (`#0a0a0a`, neutral — slightly darker) |
| `--card` | `oklch(0.205 0.014 285)` | `#232228` | `surfaceRaised` (`#171717`) |
| `--secondary` / `--muted` | `oklch(0.255 0.01 285)` | `#2b2a30` | `surfaceMuted` (`#1f2023`) |
| `--accent` (hover) | `oklch(0.275 0.018 285)` | `#322f39` | `surfaceMuted` or a +6% lift of it |
| `--foreground` | `oklch(0.96 0.008 285)` | `#f3f2f6` | `text` (`#fafafa`) |
| `--muted-foreground` | `oklch(0.7 0.015 285)` | `#a5a3ac` | `textMuted` (`#a1a1a1`) |
| `--border` / `--input` | `white / 12%` / `16%` | `rgba(255,255,255,.12)` | `border` (`#ffffff1f` = white 12%) ✅ exact match |
| `--primary` (**violet**) | `oklch(0.7 0.17 293)` | **`#a684f9`** | **ADD `brandViolet`** (currently `brand500` is green) |
| `--primary-emphasis` | `oklch(0.77 0.15 293)` | `#bb9dfb` | **ADD `brandVioletEmphasis`** |
| `--primary-foreground` | `oklch(0.16 0.015 285)` | `#1a1920` | `onBrand` (`#00140c`) — or add `#1a1920` |
| `--destructive` | `oklch(0.69 0.19 25)` | `#f26a5b` | `danger` (`#ff6467`) ✅ close |
| `--ring` | `oklch(0.7 0.15 293)` | `#a98cf5` | violet ring — **not** `focus` (`#7cd2ae` is green) |
| `--chart-2` (diff additions) | `oklch(0.67 0.12 185)` | `#2fb3a3` (teal-green) | `brand500` (`#58c69b`) reads fine as "additions green" |

**Aurora / hero artwork brand family** (dark, from `tokens.css` `.dark`) — add these:

| Var | oklch | approx hex |
|---|---|---|
| `--brand-violet` | `oklch(0.7 0.17 293)` | `#a684f9` |
| `--brand-lilac` | `oklch(0.68 0.13 315)` | `#c47dd0` |
| `--brand-magenta` | `oklch(0.64 0.17 330)` | `#cf5a9c` |
| `--brand-periwinkle` | `oklch(0.63 0.16 275)` | `#7d7ee6` |
| `--brand-cyan` | `oklch(0.72 0.09 210)` | `#58b6cd` |

Hex values are sRGB approximations of the oklch source; if exactness matters,
convert the oklch in `tokens.css` with a culori-based script (the same pipeline
`tokens:generate` already uses).

> Throughout this doc, **"accent/primary" = violet `#a684f9`** (the desktop
> truth). Where you decide to keep green instead, swap `brand500` in and know
> it's a deliberate deviation from Cline.

---

## 1. Global

### Background
Flat dark canvas on working screens. First run uses the animated desktop aurora
(Section 2 + 8); the populated session list stays quiet and scannable. Page
background = `canvas`. Cards/panels = `surfaceRaised`. Muted fills (chips and
code) = `surfaceMuted`.

### Fonts
- Sans: `font.sans` → **Schibsted Grotesk** (`"Schibsted Grotesk Variable"`), fallback system sans.
- Mono: `font.mono` → **Azeret Mono**, fallback ui-monospace.
- Bundle both via `expo-font`. Body copy is sans; code, diff counts, timestamps, token/cost stats are mono.

### Type scale (from `tokens.css`)
| Name | size / line-height | letter-spacing | usage |
|---|---|---|---|
| xs | 12 / 16 | +0.0025em | timestamps, meta, diff counts, code, chips |
| sm | 14 / 20 | 0 | **body / chat default**, message text, tool labels, titles |
| base | 16 / 24 | 0 | composer textarea input |
| lg | 18 / 26 | −0.0025em | rare section headings |
| xl | 20 / 28 | −0.005em | — |
| 2xl | 24 / 30 | −0.00625em | — |
| 3xl | 28 / 36 | −0.0075em | — |
| hero | `clamp(32, 3vw, 41.6)` / 1.12 | −0.025em | welcome hero heading |

11px (`text-[11px]`) is used ad hoc for the tightest meta (session time,
approval meta, footer bar). Treat as a `caption` = 11/14.

### Font weights (variable-font values — remap for RN)
Desktop uses variable weights: normal **480**, medium **560**, semibold/bold
**640**. Standard RN fonts don't hit these; map: `normal→"400"`, `medium→"500"`,
`semibold→"600"`, `bold→"700"`. If shipping the variable Schibsted Grotesk,
you can pass the exact numeric weights.

### Spacing scale
Tailwind 4-based (1 unit = 4px). Common values seen: 2/4/6/8/12/16/20/32/44px.
Card padding 12px (`p-3`), section gaps 8px (`gap-2`), tight gaps 4–6px.

### Corner radii
Desktop `--radius` = 8px, with `sm 4 / md 6 / lg 8 / xl 12`. RN `tokens.radius`
is `sm 6 / md 8 / lg 12`. Map desktop→RN:
- 4px chat bubbles, tool-code corners → RN `radius.sm` (6) or a literal `4`.
- 6px (`radius-md`) buttons, chips, options → RN `radius.sm` (6).
- 8px (`radius-lg`) cards, panels, reasoning box → RN `radius.md` (8).
- 12px (`radius-xl` / `rounded-xl`) composer, quick-action card, approval panel → RN `radius.lg` (12).
- Pills / status dots / round send button → `999`.

### Borders / dividers
Hairline `1px` in `border` (white 12%). Many desktop uses soften further:
`border@80%`, `@70%`, `@60%`, `@40%` — replicate with the same color at reduced
alpha (e.g. `rgba(255,255,255,0.08)` for `@60%`). Dividers between list rows =
same hairline.

### Elevation / shadow
Desktop is nearly flat; shadows are subtle. Use `shadow.raised`
(`0 1px 2px rgb(0 0 0 /.35), 0 12px 32px rgb(0 0 0 /.22)`) for popovers/sheets.
Cards mostly rely on the border, not shadow. RN: low `elevation` (2–4) or a soft
`shadowOpacity ~0.3`.

### Motion
Durations `fast 120ms / normal 180ms`, easing `cubic-bezier(0.2,0,0,1)`
(≈ Reanimated `Easing.bezier(0.2,0,0,1)`). Spinners: tool progress 800ms linear,
approval spinner 1000ms linear. Honor `prefers-reduced-motion` (RN:
`AccessibilityInfo.isReduceMotionEnabled`) — disable aurora, shimmer, hero anim.

---

## 2. Home and first run

After setup, Home starts the user's next conversation; infrastructure remains a
compact target choice rather than a launcher.

1. The desktop welcome hierarchy remains visible whether or not sessions exist:
   aurora, “What would you like to…?”, workspace-style target trigger, welcome
   composer, vertically centered as one group. Starter actions are intentionally
   hidden while desktop keeps its welcome suggestions disabled.
2. Cloud sessions and paired-computer entries share one newest-first history
   sheet opened from the header—the mobile equivalent of the desktop sidebar. The
   title and tap behavior are primary; the Cloud/computer source is secondary
   metadata expressed by the row icon and location label.
3. The header is transparent and titleless; it contains the Cline mark, session
   history, and Settings. Setup actions do not leak back into configured Home.
4. The target trigger occupies desktop's workspace-control position. The
   composer has exactly one outer welcome-card border, a borderless textarea,
   and a divided footer carrying Cline/provider identity and Send.
5. Search appears inside history only once the combined list reaches 8 rows.
6. A source failure degrades independently. If Cloud is unavailable, paired
   computers remain usable and one banner explains the missing Cloud rows.
7. A paired endpoint with no session metadata is labelled as the computer itself;
   the UI must not invent a fake “Latest session.” Once `/handoff` provides real
   session identity, it is rendered like any other session.
8. Raw URLs, tokens, and endpoint removal live in Settings → Connections →
   Advanced, never in the normal Home flow.

First run is a full-screen branded setup flow, not an inert Home. It offers two
ways to create a runnable execution target: run `/handoff` in Cline and scan
the QR, or sign in to Cline and select a GitHub repository plus model for Cloud.
Readiness is derived from persisted targets—there is no separate
`onboardingComplete` flag. As soon as either target exists, the app opens Home
with the composer ready. Settings can reopen the same flow to add or change a
target; these setup choices are not permanent top-level destinations.

---

## 3. Sessions list (from `agent-sidebar.tsx`)

### Row anatomy (`SessionThreadRow`)
- Container: height **32px** (`h-8`), `flexDirection:row`, `borderRadius 6/8`, horizontal padding 8px, `alignItems:center`, `justifyContent:space-between`.
  - Default: text `textMuted`(@80%). **Active:** background `surfaceMuted` (`sidebar-accent`), text `text`. **Pressed/hover:** background `surfaceMuted @50%`.
- **Left:** session title, `sm` (14px), weight 400, single line, ellipsized; when `session.list` supplies `metadata.prompt`, show a muted one-line prompt snippet below it.
- **Right cluster** (`flex-row gap 6px`, `caption` 11px `textMuted`):
  - Status/marker dot **6px** (`size-1.5`), round: pending=`#facc15` (yellow-400), running=`#22c55e`/`brand500` green, unread=`#3b82f6` (blue-500), else hidden. **Favorited** replaces the dot with a filled `Star` (12px).
  - Timestamp: 11px `textMuted` (e.g. "2h", "3d").

### Status chip colors per state
Desktop status enum is `idle | starting | running | stopping | completed |
cancelled | failed | error`. Presentation is centralized (`lib/session-status.ts`)
into 3 tones via a dot (`SessionStatus` component, 8px dot, `caption` label):

| Requested state | Real enum alias | Tone | Dot color |
|---|---|---|---|
| provisioning | `starting` | neutral | gray `#6b7280` |
| ready | `idle` | neutral | gray `#6b7280` |
| active | `running` | running | green `#22c55e` (or `brand500`) |
| failed | `failed` / `error` | error | red `#ef4444` (`danger`) |
| expired | `cancelled` / `stopping` | neutral | gray `#6b7280` |
| (done) | `completed` | neutral | gray `#6b7280` |

Dot component (`session-status.css`): 8px round, `gap 6px` to label, label `xs`
(12px) `textMuted`. Tone only recolors the dot (running→accent, error→danger).
For a fuller "chip", wrap dot+label in a `surfaceMuted` pill (`radius 6`,
`px 8 py 2`, `caption`).

### Search field

Hide search while fewer than 8 rows exist. A full-width search box over one or
two sessions adds chrome without helping; filtering remains available as soon as
the list is large enough to need it.
Sidebar uses a plain input with a `Search` (lucide) icon. Reusable pattern from
`search-combobox.css`:
- Shell: `flexDirection:row`, `alignItems:center`, gap 8px, `borderRadius 6`, background `canvas`/`surfaceMuted`, padding `6px 10px`.
- Icon: `Search` 12px `textMuted`.
- Input: `xs`→`sm` (12–14px), `textMuted` text, placeholder `textMuted`, transparent bg, no border.
- Results panel (if combobox): `border 1px`, `borderRadius 12`, background `surfaceRaised` (popover), shadow `raised`, `maxHeight ~224px`, options `borderRadius 6`, padding `6px 8px`, hover/selected background `surfaceMuted`.

### Empty state
When there is no recent work but a runnable target exists, keep the new-message
composer as the primary surface; history shows its own empty state only when
opened. When no target exists, render the first-run setup surface
from §2. Search with no matches uses a
centered column (`minHeight ~256px`, gap 12px, padding 32px)
with title “No sessions match” and a body that echoes the query.

---

## 4. Chat transcript (from `agent-chat.css` + `chat-messages.tsx`)

Conversation content: vertical list, gap **8px**, base font `sm` (14px), color `text`.

### User message
- **Right-aligned bubble.** `maxWidth 85%` (desktop widens to 50% on ≥768px — on phone keep 85%).
- Padding 8px, `borderRadius 4` (desktop `calc(radius - 4px)`), background `surfaceRaised` (`--card`), text = `text` @80% alpha.

### Assistant message
- **Full-width, no bubble, no background.** Text color `text`. Markdown-rendered (headings ramp: h1 20, h2 18, h3 16, h4–6 14; block gap 12px; inline code `surfaceRaised` bg, 13px, padding `.1em .35em`; code blocks `surfaceRaised` bg, `radius 8`, padding `10px 12px`, 13px/1.6 mono).
- **Error message:** padding 12px, border `1px danger@40%`, `radius 8`, background `danger@10%`, text `danger`.
- **System/status message:** text `textMuted`.
- Message action row (copy / restore checkpoint / edit / fork) appears on hover on desktop; on touch it's **always visible** (`@media (hover:none)` forces `opacity:1`). Actions: 24px tall, `caption`, `textMuted`, transparent, hover bg `surfaceMuted`. Icons: `Copy`/`Check` (copy), `Undo` (restore checkpoint), `Pencil` (edit), `Split` rotated 90° (fork).

### Reasoning block (collapsible)
- Wrapper margin `8px 0`, full width.
- Consecutive reasoning fragments are grouped into one disclosure and collapsed by default. A long turn must not become a wall of internal thought before the answer.
- **Trigger row:** `flexDirection:row`, gap 8px, minHeight 28px, `sm` weight 500, color `text @70%` (→ `text` when expanded/hover). Contents: `Brain` icon 16px, label, disclosure chevron (`ChevronDown`) that **rotates 180°** when open (animate with Reanimated).
  - Label text: `"Thinking"` while streaming (with shimmer, below) → `"Thought for {n}s"` when done.
- **Expanded panel — LEFT RAIL style** (this is the real Cline look, `EXPANDED_PANEL_RAIL_CLASS` overrides the default box): **no border box**; instead a single **left border** `1px` `border`, `marginLeft 4px`, `paddingLeft 8px paddingVertical 4px`, background transparent, `sm`, `opacity .7` (→1 on focus/hover), `maxHeight ~192px` scroll-Y. Text `textMuted`, line-height 1.625, mono not required (reasoning is prose).
- **Streaming shimmer** (`.cline-chat-streaming-title`): the running title text animates a left-to-right brightness sweep (2.25s linear loop) over `currentColor`. RN: `MaskedView` + an animated `expo-linear-gradient` translated across, or a simpler pulsing opacity. Disable under reduced motion.

### Tool-activity card (from `.cline-chat-tool*` + `chat-messages.tsx`)
- Wrapper margin `8px 0`, full width.
- **Trigger row:** `flexDirection:row`, gap 8px, minHeight 28px, `sm` weight 500. **Color = accent (`brandViolet`)** for normal, `danger` for error status, `textMuted` for pending.
  - **Icon** (16px, tool-specific — see §7 map): e.g. `Terminal` for run_commands, `Pencil` for edits, `SearchCode` for search, `Files` for reads.
  - **Label** (flex, wraps): human phrasing built from tool + input, e.g.
    - file edit: `"Editing src/foo.ts +12 -3"` (streaming) / `"Edited src/foo.ts +12 -3"`.
    - commands: `"Running command"` / `"Ran command"` (or the counted plural).
    - reads: derived from paths.
  - **Diff counts** (mono, `xs`): `+N` in additions-green (`--chart-2` → `brand500` `#58c69b`) and `-N` in `danger`. Rendered as separate spans.
  - **Progress spinner** while running: 12px, `2px` ring `brandViolet@25%` with top edge `brandViolet`, spin 800ms linear. (Replaces/join the icon.)
- **Expanded content:** `marginTop 6px`, **paddingLeft 32px** (aligns text under the trigger label, past the icon), `textMuted`, `sm`. Details render as a small grid (gap 4px).
- **Tool code block** (`ToolActivityCode`): mono `xs`, `maxHeight ~208px` scroll, padding 8px, border `1px border@70%`, `radius 6`, background `canvas@60%`, text `text`, line-height 1.625, pre-wrap. Horizontal scroll bar hidden but axis live (§ globals note — RN `ScrollView horizontal` inside).
- Edit-shaped tools replace the raw patch code block with a per-file colored diff preview. Tapping it opens a full-screen review surface. Diff counts are never inferred from command output.

### State summary for tool cards
| State | Trigger color | Indicator |
|---|---|---|
| pending / queued | `textMuted` | (dim) |
| running / streaming | `brandViolet` | 12px violet spinner (800ms) + shimmer label |
| completed | `textMuted` | tool icon, `+N/-N` counts |
| failed / error | `danger` | tool icon in red |

### Usage / footer
Per-session token/cost stats live in the composer footer bar and header diff
pill (§5, §ChatHeader), not as a per-message footer. Header diff pill: `secondary`
(`surfaceMuted`) bg, `radius 6`, `px 8 py 4`, mono `xs`, `+N` in additions-green,
`-N` in `danger`; tapping opens the diff view.

### Scroll-to-bottom button
Absolute, bottom-right (16px inset), 36px round, `border 1px`, background
`surfaceMuted`, `text` icon (`ChevronDown` / down arrow), soft shadow.
The transcript follows appended/streaming content only while the user remains
within 72px of the tail. Scrolling upward disables follow and reveals this button;
tapping it resumes follow. Respect reduced motion when scrolling.

While a tool is running, a fixed strip above the composer names the current
activity and elapsed time; tapping it returns to the transcript tail. Messages
with known event timestamps gain day separators, and long-press reveals their
relative time.

---

## 5. Composer (from `chat-input-bar.tsx`)

### Outer container
- **Welcome variant:** `borderRadius 12` (`rounded-xl`), `border 1px` (`border@90%`), background `surfaceRaised@90%` + **backdrop blur** (`backdrop-blur-md` → `expo-blur` `intensity ~40`), soft glow shadow tinted violet (`0 24px 80px -56px brandViolet@72%`).
- **Conversation variant:** top border `1px` `border`, background `surfaceRaised@95%` + light blur (`backdrop-blur-sm`). No radius (docked to bottom).

### Input field
- Inner shell: `flexDirection:row`, `alignItems:flex-end`, gap 8px, `borderRadius 8`, `border 1px border`, background `canvas`, padding `12px 10px` (`px-3 py-2.5`). **Focus:** border `brandViolet@50%` + ring `1px brandViolet@20%` (RN: animate border color + a faint outer glow).
- Textarea: transparent, `base`/`sm` (14–16px), line-height 20, color `text`, placeholder `textMuted`, auto-grow `maxHeight ~240px`, `minHeight 20`.
  - Placeholders: busy → `"Agent is working… Send another message to queue it"`; default → `"Message Cline…"`. Do not mention `/` or `@` until their pickers exist.
- Attachment chips (below input when present): `flex-row wrap gap 6px`; each chip `inline-flex`, `borderRadius 999`, `border 1px border`, background `surfaceMuted`, `px 8 py 4`, `xs`, `text`; remove `X` button 12px `textMuted`.

### Footer bar (controls)
`flex-row justify-between`, top border `1px border`, padding `8px 12px`, `caption`
(11px) `textMuted`. Left→right:
- **Attach** button: 16px `Paperclip`, padding 6px, `radius 6`, `textMuted` → hover bg `surfaceMuted` + `text`.
- **Model / reasoning-effort picker:** render only when the protocol can report a
  real current value or accept a real change. An informational “Model” pill that
  opens only a limitation explanation does not belong in primary composer chrome.
- **Token/cost summary**: `Coins` icon + mono `caption` (e.g. "12.3k · $0.04"), hidden on very narrow widths.

### Send / abort button (right cluster)
- **Send:**
  - Conversation variant: **round** (`radius 999`), background `text` (white), icon `ArrowUp` 16px in `canvas` (background color). Hover → `text@80%`.
  - Welcome variant: `radius 6`, background **violet gradient** `linear-gradient(145deg, brandVioletEmphasis, brandViolet)`, white `ArrowUp`, soft shadow, hover brightness +10%. RN: `expo-linear-gradient` behind an `ArrowUp`.
  - Disabled (no draft): `opacity .5`, not pressable.
- **Abort** (shown while `running`/`stopping`): background `text`, icon `CircleStop` 16px in `canvas`; round in conversation, `radius 6` in welcome.
- Streaming state: abort visible; send stays available only if there's a queued draft (to enqueue another message).

---

## 6. Approval (from `agent-approval-card.tsx/.css` + `chat-messages.tsx`)

### Approval panel wrapper (group frame)
Amber-accented section around one or more approval cards:
- `borderRadius 12`, `border 1px` amber `rgba(251,191,36,.40)` (amber-400/40), background amber `rgba(245,158,11,.05)` (amber-500/5), padding 12px.
- Header row: `ShieldAlert` icon 16px in amber `#f59e0b`, then `"Tool approval required"` `sm` weight 500 `text`.
- Subtitle: `xs` `textMuted` — "Review each tool call and approve or reject it before execution."
- Cards stacked with 8px gap.

### Approval card (`AgentApprovalCard`)
- Container: `border 1px border@80%`, `borderRadius 8`, background `canvas@70%`, padding 12px.
- Header: `flex-row justify-between`, title = tool name, `sm` weight 500 `text`; meta (right) = `Clock3` 12px + timestamp, `caption` (11px) `textMuted`.
- Description: `caption` (11px) `textMuted`, e.g. "Request {id} · Iteration {n}".
- **Detail (input summary):** mono `xs`, `border 1px border@70%`, `radius 6`, background `canvas`, padding 8px, `maxHeight 176px` scroll, `textMuted`, pre-wrap. (This is the tool-input JSON/command preview.)
- Error (if any): `xs` `danger`.
- **Actions row** (`flex-row gap 8px`, marginTop 8px):
  - **Approve:** height 32px, `radius 6`, `px 12`, weight 500, background `brandViolet` (`--primary`), text `onBrand`/`#1a1920`. Pending → spinner (14px, 1s linear) + "Approving...".
  - **Reject:** height 32px, `radius 6`, `px 12`, weight 500, `border 1px` (`input`), background `input@30%` (dark), text `text`. Pending → spinner + "Rejecting...".
  - Both `opacity .5` + non-interactive while responding.

### Ask-question panel (sibling of approval)
Blue-accented: `border 1px` blue-400/40, background blue-500/5, `MessagesSquare`
icon 16px blue `#3b82f6`, header "Follow-up question", subtitle `xs` `textMuted`.
Each item: `border 1px border@80%`, background `canvas@70%`, `radius 8`, padding
12px; question `sm` weight 500; option buttons = `outline` buttons (`sm`), pending
→ `Loader2` spin + "Sending...".

### RN: approval as a bottom sheet
Desktop renders approval inline in the transcript. On mobile, surface an urgent
approval in a **bottom sheet** (`@gorhom/bottom-sheet`) for reachability:
- Sheet content background `surfaceRaised`/`canvas`, top corners `radius 12`, drag handle, padding 16px, overlay `rgba(0,0,0,.5)` (matches `sheet.tsx` overlay). Slide-up 500ms in / 300ms out.
- Put the approval card inside; approve/reject buttons pinned at bottom (`SheetFooter`: `mt-auto flex-col gap 8px p-4`). Keep the inline card too for non-blocking review; escalate to the sheet when the agent is actually waiting.

---

## 7. Iconography (lucide-react → lucide-react-native)

All icons below exist in `lucide-react-native` with the same names.

### Tool-activity icons (by normalized tool name — `TOOL_NAME_ICONS`/`TOOL_KIND_ICONS`)
| Tool | Icon |
|---|---|
| run_commands (bash) | `Terminal` |
| read_files (file-read) | `Files` |
| search_codebase / search (exploration) | `SearchCode` |
| editor / apply_patch / edit_file (file-edit) | `Pencil` |
| fetch_web_content / web_fetch | `PanelsTopLeft` |
| skills | `Library` |
| spawn_agent / subagent_* | `User` |
| team / teams / team_* | `Users` |
| mcp | `Box` |
| plugins | `Blocks` |
| submit_and_exit | `SquareArrowRight` |
| ask_question | `MessageCircleQuestionMark` |
| generic / unknown tool | `Wrench` |
| reasoning block | `Brain` |
| disclosure chevron (reasoning/tool) | `ChevronDown` (rotates 180° open) |

### Composer
`ArrowUp` (send), `CircleStop` (abort), `Paperclip` (attach), `Coins` (tokens),
`Cpu` (model), `Brain` (reasoning effort), `ChevronDown`/`ChevronRight` (menus),
`Check` (selected), `X`/`Trash2` (remove attachment), `Pencil` (edit queued).

### Chat message actions & header
`Copy`/`Check` (copy), `Undo` (restore checkpoint), `Pencil` (edit message),
`Split` rotated 90° (fork), `MoreHorizontal` (session actions), `Plus` (new
session), `Trash2` (delete), `CornerUpLeft` + `Bot` (back to parent agent).

### Diff view (`diff-view.tsx`)
`X` (close), `ChevronDown`/`ChevronRight` (expand file), `Plus` (added line),
`Minus` (removed line), `Copy`/`Check` (copy path), `ExternalLink` (open in
editor), `AppWindow` (system default).

### Approval / ask-question / agents
`ShieldAlert` (approval, amber), `MessagesSquare` (question, blue), `Clock3`
(timestamp / stalled), `Bot` (agents), `Loader2` (running spinner), `Check`
(completed), `AlertCircle` (failed), `ChevronRight` (roster row).

### Sidebar / sessions
`Search` (search), `Filter` (filter), `ArrowDownUp` (sort), `Star` (favorite,
filled when active), `GitFork` (fork), `Plus` (new), `MessagesSquare`/`Bot` etc.

---

## 8. Cline logo (for `react-native-svg`)

From `ui/packages/react/src/cline-logo.tsx`. Single path, `fill="currentColor"`,
`viewBox="0 0 40 40"`, default 40×40. Reproduce with `<Svg viewBox="0 0 40 40">
<Path fill={color} d={...} /></Svg>`.

```
M38.8258 22.5937L36.4373 17.7684V14.9895C36.4373 10.3832 32.763 6.65263 28.2315 6.65263H24.1494C24.4449 6.04211 24.6072 5.35579 24.6072 4.63158C24.6072 2.07158 22.5599 0 20.0299 0C17.4999 0 15.4527 2.07158 15.4527 4.63158C15.4527 5.35579 15.6149 6.04211 15.9104 6.65263H11.8283C7.29684 6.65263 3.62256 10.3832 3.62256 14.9895V17.7684L1.18413 22.5811C0.938623 23.0653 0.938623 23.6421 1.18413 24.1263L3.62256 28.8842V31.6632C3.62256 36.2695 7.29684 40 11.8283 40H28.2315C32.763 40 36.4373 36.2695 36.4373 31.6632V28.8842L38.8216 24.1095C39.0588 23.6337 39.0588 23.0737 38.8258 22.5937ZM17.5332 26.5263C17.5332 28.6189 15.8563 30.3158 13.7882 30.3158C11.7201 30.3158 10.0432 28.6189 10.0432 26.5263V19.7895C10.0432 17.6968 11.7201 16 13.7882 16C15.8563 16 17.5332 17.6968 17.5332 19.7895V26.5263ZM29.6005 26.5263C29.6005 28.6189 27.9236 30.3158 25.8555 30.3158C23.7874 30.3158 22.1105 28.6189 22.1105 26.5263V19.7895C22.1105 17.6968 23.7874 16 25.8555 16C27.9236 16 29.6005 17.6968 29.6005 19.7895V26.5263Z
```

Shape: a rounded-hexagon/cube outline (the "chip") enclosing **two vertical
rounded bars** (the "eyes") — the classic Cline mark. Color it `text` (white) on
dark, or `brandViolet` for an accented lockup. Pass a `title`/`accessibilityLabel`
"Cline".

### Aurora background (welcome only — `agent-aurora.tsx/.css`)
Decorative, `absolute inset:0`, `overflow:hidden`, `pointerEvents:none`. Layers,
all masked top+bottom with a **vertical** gradient (transparent→opaque 32%→68%→
transparent) so bands fade at edges:
1. **Horizon band** — bottom, `height 40%`, horizontal gradient lilac→magenta→periwinkle→cyan, opacity ~0.6, slow drift (8s).
2. **Two "current" bands** (left/right) — angled linear gradients (magenta/periwinkle and cyan/violet), opacity ~0.45–0.5, drift 9–12s.
3. **Two radial "blobs"** — bottom-left periwinkle, bottom-right violet, `radial-gradient` fading to transparent by 70%, drift 11–12.5s.
4. **32 twinkling stars** — 2–4px, mostly white-lilac, ~22% cyan, opacity 0.15↔0.78 twinkle 3.5–7s.

**RN implementation:** linear-gradient bands via `expo-linear-gradient`; radial
blobs via `react-native-svg` `<RadialGradient>` (expo-linear-gradient can't do
radial); vertical edge mask via `@react-native-masked-view` over each band;
drift/twinkle via `react-native-reanimated` loops. **Simplify aggressively** —
a static or slow 2-blob + horizon version reads the same on a phone; drop stars
or render a handful. Disable all motion under reduced-motion (desktop does).

---

## RN implementation notes

### Libraries
- **react-native-svg** — Cline logo, aurora radial blobs, any custom vector.
- **lucide-react-native** — every icon in §7 (same names).
- **expo-linear-gradient** — welcome send-button gradient, hero word gradient (with mask), aurora linear bands.
- **@react-native-masked-view/masked-view** — native masks used by Expo Router.
- **expo-blur** — composer backdrop blur (`backdrop-blur-md/sm`), popover/sheet frosting. Fallback: solid `surfaceRaised@95%` if blur is too costly.
- **react-native-reanimated** — disclosure chevron rotate, tool/approval spinners, shimmer sweep, aurora drift, hero char-in. Gate all on reduced-motion.
- **@gorhom/bottom-sheet** — approval sheet, model picker, session overview, any menu.
- **expo-font** — bundle Schibsted Grotesk + Azeret Mono (`font.sans`/`font.mono`).

### Things that don't translate 1:1 (and the substitute)
| Desktop (web) | RN substitute |
|---|---|
| Violet `@cline/ui` accent vs green RN `brand500` | **Add `brandViolet`/`brandVioletEmphasis` tokens**; use for primary/accent (product decision — see top banner). |
| `backdrop-blur` on composer/panels | `expo-blur`; fallback opaque `surfaceRaised`. |
| CSS radial-gradient aurora blobs | `react-native-svg` `RadialGradient`. |
| Background-clip text gradient (hero) | `MaskedView` + `LinearGradient`; fallback solid violet. |
| Hover states (message actions, quick-action arrow, rows) | `Pressable` pressed styles; message actions **always visible** on touch (desktop already does this via `@media (hover:none)`). |
| `color-mix(... % transparent)` alpha blends | Pre-compute rgba (e.g. `border@60%` → `rgba(255,255,255,0.072)`). |
| Variable font weights 480/560/640 | Map to 400/500/600 (or ship variable font). |
| Horizontal-scroll-with-hidden-bar tool code | RN nested `ScrollView horizontal`. |
| Shimmer streaming title | Reanimated masked gradient sweep, or pulsing opacity. |

### Component inventory (build wave should produce)
**Theme/primitives:** `ThemeProvider` (dark), `Text` (variant: hero/title/body/caption/mono), `Button` (variant: primary/secondary/outline/ghost/destructive; size sm/default/icon), `Card`/`Surface`, `Chip`/`Badge`, `StatusDot`, `Divider`, `IconButton`, `Spinner`, `TextField`, `SegmentedControl`, `AutoGrowTextarea`, `BottomSheet`.
**Brand:** `ClineLogo`, `AgentWelcomeHero`, `StartupScreen`.
**Setup:** `PairComputerState`, `CommandLine`.
**Home:** `HomeScreen`, unified `SessionRowView` list; `IntroScreen` uses
`AgentWelcomeHero` above the composer or setup content.

**Destinations:** `DestinationScreen`, `CloudAccountCard`, `CurrentSessionCard`,
`SessionRowView`, `SessionStatusChip`, conditional `TextField`.
**Chat:** `ChatScreen`, `ChatHeader` (title + status dot + diff pill + new/parent), `MessageList`, `UserMessageBubble`, `AssistantMessage`, `MarkdownRenderer`, `ReasoningBlock` (collapsible left-rail), `ToolActivityCard` (icon + label + `+N/-N` + state), `ToolCodeBlock`, `DiffView` + `DiffFileSection` + `DiffHunk`, `ScrollToBottomButton`.
**Composer:** `Composer`, `SendButton`, `AbortButton`, `AutoApprovePill`, `AutoApproveSheet`, `UsageSummary`; model/context/attachment controls join only with working capabilities.
**Approval:** `ApprovalPanel` (amber frame), `ApprovalCard`, `ApprovalBottomSheet`, `AskQuestionPanel` (blue frame).
```
