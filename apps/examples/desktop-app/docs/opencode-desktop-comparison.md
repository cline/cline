# Cline Code vs. OpenCode Desktop — Competitive Gap Analysis

**Date:** 2026-08-05
**Cline Code:** `@cline/code` v0.0.8, built from this repo (`apps/examples/desktop-app`, Tauri v2 + Next.js + Bun sidecar → Cline Hub)
**OpenCode Desktop:** `@opencode-ai/desktop` v1.18.13, built from [anomalyco/opencode](https://github.com/anomalyco/opencode) `packages/desktop` (Electron 42 + Solid.js → shared OpenCode server)

**Methodology:** Both apps were built from source and run side by side on the same Linux desktop. A fresh-profile first-run was captured for both (OpenCode via its `OPENCODE_TEST_ONBOARDING=1` flag). The same demo git project and the same coding task ("Add a subtract(a, b) function to math.js") were run in both apps, followed by a systematic walkthrough of every settings surface, composer feature, and in-session feature that could be reached. UI findings were cross-checked against both codebases.

---

## 1. Executive summary

OpenCode Desktop is a **thicker IDE-like client**: embedded terminal, git review panel, worktrees, multi-window, tabs, editable keybindings, 30+ themes, 29 UI locales, deep links, WSL support, and session share. Its center of gravity is *the session as a workspace*.

Cline Code is a **thinner, more opinionated chat client with a much deeper platform behind it**: a real onboarding flow, an account/credits/billing system, 183 providers, marketplaces for plugins/skills/MCP, channels (Slack/Discord/Telegram/...), scheduled jobs, hooks, and shared state with the CLI through the Hub. Its center of gravity is *the agent platform*.

The biggest competitive gaps are (a) in-session depth — terminal, review/diff panel, file tree — where OpenCode currently feels like a more complete daily driver, and (b) safety/trust controls — Cline ships with silent auto-approve (YOLO) and hides its Plan/Act toggle, while OpenCode has a permission dock, per-scope auto-accept, and question/todo docks. Cline's platform surface (accounts, marketplaces, schedules, channels) is well ahead of anything OpenCode has, and its onboarding is dramatically better. The strategy that beats OpenCode is: keep the platform lead, close the ~6 in-session gaps, and turn safety into a visible feature instead of a hidden default.

---

## 2. Onboarding and first-run

### What each app does

| | Cline Code | OpenCode |
|---|---|---|
| First-run flow | 3-step wizard: welcome → connect a provider → done (`webview/components/views/onboarding/onboarding-view.tsx`) | None. Splash → auto-creates `Documents/Default Project` → drops into a draft session (`desktop/src/main/onboarding.ts`) |
| Auth pressure | Connect step offers Cline sign-in (browser OAuth), Cline API key, or BYO API key; **Skip for now** available | Zero. Free "Big Pickle" model selected by default; provider connect deferred until needed |
| Provider setup during onboarding | API-key-only providers (Anthropic, OpenAI, OpenRouter, Gemini, xAI, Groq, Mistral, DeepSeek, Ollama...) | Not part of first run; later via Connect Provider (API key + OAuth device-code flows, incl. Claude Pro/Max, GitHub Copilot) |
| Workspace/project selection | Not part of first run | Auto-created default project; picker on new session |
| Time to first prompt | ~30–60 s (with key ready) | ~0 s |

### Assessment

- Cline's wizard is genuinely good — clean, skippable, verified key entry (bad Cline keys are rolled back after a failed `fetchMe`), and it funnels users to the paid account. Nothing to remove here.
- OpenCode wins on **time-to-first-token for a user with no credentials**: a free default model plus auto-created project means the first prompt can be typed immediately. Cline has no equivalent "works before you sign in" path; **Skip for now** lands you in a composer that cannot run a turn.
- OpenCode's onboarding gap is discoverability — nothing explains the terminal, review panel, or keybinds. Cline could combine its wizard *and* a zero-credential free path and beat both.

**Opportunities**
1. Offer a free/promo default model behind the Cline provider so onboarding can complete with zero keys ("try it now, sign in when you want more").
2. Add a workspace/project selection step (or an explicit "we'll use your home folder / pick later" affordance) — currently the post-onboarding welcome screen silently points at whatever the sidecar resolved.
3. Post-onboarding feature tour (what `@`, `/`, checkpoints, and the sidebar do). Neither app has one; cheap differentiation.

---

## 3. The core agent loop (same task, both apps)

Task: `Add a subtract(a, b) function to math.js` in the same git repo, Claude Sonnet 5 on both sides.

| Dimension | Cline Code | OpenCode |
|---|---|---|
| Result | Correct edit, followed existing style | Correct edit, followed existing style |
| Transcript rendering | Collapsible timeline: "Ran 1 command", "Thought for 4s", "Read 1 file. Edited 1 file." with expandable detail | Flat compact rows: `Shell find ...`, `Explored 1 read`, `Edit math.js +4 -0` with inline expandable diff |
| Diff view | Good: syntax highlighting, +4 −0 chips, header diff count, "Uncommitted changes" panel, **Open in editor** | Good: inline diff in transcript + dedicated review panel (below) |
| Approval before file edit | **None — silent** (`autoApproveTools: true` default → sidecar `yolo` prompt mode; no UI to change it) | None for this task under its defaults; but a **permission dock** (Deny / Allow once / Allow always + patterns) and a global+per-session auto-accept toggle exist |
| Completion UX | Final summary message; however the header status stayed "Agent is working…" for several minutes after work finished in one run (state-machine or streaming-status bug worth investigating) | Clear completion; "1 Changed file +4 −0" summary card |
| Cost/token visibility | Session details: tokens (19k) and cost ($0.016); context-window meter in composer | None visible in session UI |
| Checkpoints/undo | Checkpoints with restore; edit-earlier-message forks + rewinds | `/undo`, `/redo`, revert dock, fork dialog |

### Assessment

- Quality of the loop itself is comparable; both render tools legibly. Cline's cost/context meters are a real advantage — OpenCode shows no cost anywhere.
- Cline's silent-YOLO default is the single most dangerous product gap: competitors present "the agent asked me before touching my repo" as a trust feature; today Cline Code has **no visible approval control at all** (the Plan/Act toggle is rendered with `hidden` in `chat-input-bar.tsx`, and there is no auto-approve setting in the UI).
- The stuck "Agent is working…" status (observed once for 6+ minutes after the final message existed) undermines trust in exactly the moment the product is proving itself.

**Opportunities**
1. Ship the approval/permission story: un-hide Plan/Act, add an auto-approve control (ideally per-tool, per-scope like OpenCode's allow-once/allow-always patterns), and default new users to *ask before edit/command* with a one-click "always allow in this project".
2. Fix the completion-status bug (status header not transitioning to done).
3. Keep and market the cost/context meters — put cost on the session list too (partially there) and consider a running per-turn cost like the CLI.

---

## 4. In-session depth (where OpenCode is ahead)

Verified hands-on in OpenCode, all absent in Cline Code today:

1. **Embedded terminal** — Ghostty-web terminal panel inside the session (multi-tab, up to 20), toggled with one key. Cline runs commands only through the agent's `run_commands` tool; the user has no shell of their own.
2. **Review panel** — a dedicated git working-tree review surface ("Files Changed", per-file diffs, filter, split/unified, line comments) independent of any one agent turn. Cline's diff panel only lists the session's uncommitted changes with per-file diffs and Open-in-editor.
3. **File tree / file viewer side panel** — browse and open project files in-app (behind a settings toggle; off by default, and genuinely hard to discover — an opportunity to do better rather than copy).
4. **Tabs + multi-window** — several sessions visible/switchable at once, drag-reorder, reopen-closed; separate OS windows with per-window tab state. Cline has one thread visible at a time with sidebar history and back/forward.
5. **Command palette** — Ctrl+K over commands, sessions, files. Cline has no palette.
6. **Editable keyboard shortcuts** — full keybind editor (two categories today, more via `desktop-menu`). Cline hardcodes ⌘/Ctrl+B only.
7. **Worktrees** — create/select git worktrees per session, with a configurable startup script per project. Nothing comparable in Cline Code (branch switcher only).
8. **Session share** — publish a session to a URL, unshare, copy link (server-config gated). Cline has no sharing.
9. **Question / todo / revert docks** — structured agent-question UI, live todo list, revert bar. Cline has ask-question rendering but no todo/revert docks.
10. **Deep links** — `opencode://open-project?directory=…`, `opencode://new-session?directory=…&prompt=…`; registered protocol + single-instance forwarding. Cline registers no URL scheme, so nothing on the web ("open this repo in Cline Code") can target the app.

**Priority recommendation:** terminal, review panel, and permission controls are the three that most change the daily-driver calculus; tabs/palette/keybinds are strong seconds; worktrees and share are differentiated but lower-frequency.

---

## 5. Platform surface (where Cline is ahead)

Verified hands-on in Cline Code, absent or much weaker in OpenCode desktop:

1. **Provider catalog** — 183 providers with per-provider forms, model enable/disable, custom OpenAI-compatible providers. OpenCode shows a curated set (~8 popular + custom) — fine for most users, but Cline's breadth is a moat for enterprise/self-hosted.
2. **Account system in-app** — profile, organizations, credits balance, usage table (per-model tokens/credits/time), billing history. OpenCode desktop has no account UI at all (auth lives per-provider).
3. **Marketplaces** — plugins (~16), skills, and 149 MCP servers, all installable in-app. OpenCode has no marketplace; MCP/plugins are `opencode.json` config.
4. **MCP management UI** — full CRUD (stdio/SSE/HTTP, env, headers, cwd, enable/disable) plus marketplace. OpenCode's desktop MCP surface is a status popover + enable/disable dialog; server definitions are config-file-only.
5. **Channels** — Discord, Slack, Telegram, WhatsApp, Google Chat, Linear connectors with start/stop from settings. No OpenCode equivalent.
6. **Schedules** — cron/one-time scheduled agent jobs with mode, workspace, timeout, parallelism. No OpenCode equivalent.
7. **Hooks / Rules / Tools management** — inspect hooks + execution history, list global/project rules, toggle built-in and plugin tools. OpenCode exposes none of this in the desktop UI.
8. **Shared Hub state with the CLI** — desktop and CLI share sessions/settings/schedules (`~/.cline/data`); sessions started in the CLI appear in the app. OpenCode's desktop spawns the same server the CLI uses but does not surface CLI sessions as a first-class continuity story.
9. **System tray** — status, running session count, quick actions; close-to-tray. OpenCode has no tray.
10. **Reasoning-effort control** — 5 levels in the composer. OpenCode has variant/thinking cycling but Cline's UI is clearer.
11. **Message queueing** — queue further turns while the agent runs, edit/steer/delete queued items. OpenCode's follow-up setting is currently forced to steer-only.

These are real differentiation, and most of OpenCode's roadmap would take quarters to replicate. The risk is none of them matter to a user who leaves in week one because there's no terminal, no palette, and no approval controls.

---

## 6. Customization, polish, distribution

| Dimension | Cline Code | OpenCode |
|---|---|---|
| Themes | Light/dark + 6 accents + 4 app icons | 37 full theme packs + scheme + UI/code/terminal fonts |
| i18n | English only | 29 locales incl. RTL (ar, ur, pa); verified live language switch |
| Keybinds | Fixed (⌘/Ctrl+B) | Editable, searchable |
| Notifications/sounds | None | Per-channel (agent/permissions/errors) OS notifications + sound packs |
| Pinch zoom / display | None | Toggle |
| Auto-update | Tauri updater (2h cadence) + separate CLI auto-update toggle; restart from sidebar | electron-updater (~10m cadence), release-notes dialog, menu + settings entry points |
| Crash/observability | OTel + file logs; UI error telemetry (settings opt-out only) | Sentry (DSN-gated), crash reporter, export-logs command |
| Windows story | Tauri (WebView2) | Electron + full **WSL** integration (install/probe/start Linux server from the app) |
| Onboarding replay | Settings → replay new-user experience | Test env flag only |

Notable: OpenCode's Linux/portal-free file dialogs (Electron GTK) worked in a bare container where Cline's `rfd` portal-based folder picker failed silently — the picker returns `None` with no user-visible error when no XDG portal is present (`pick_workspace_directory` in `src-tauri/src/main.rs`). Worth (a) falling back to the GTK backend or shipping a clear error toast, since "clicked Add project, nothing happened" is a brutal first-five-minutes bug on minimal Linux setups.

i18n and themes are lower-priority for a v0.0.x, but the notifications gap matters: long-running agent turns are exactly when users switch windows, and Cline never tells them the agent finished or needs input (tray exists but doesn't notify).

---

## 7. Bugs and paper cuts found during testing (Cline Code)

1. **Silent folder-picker failure without XDG portal** (above) — add GTK fallback or error surface.
2. **"Agent is working…" never resolves** in the header for minutes after the final message rendered (one occurrence; completion message itself did arrive).
3. **Plan/Act toggle exists but is CSS-hidden**; no auto-approve UI while the effective default is YOLO (`autoApproveTools: true` → `yolo` prompt mode in `sidecar/chat-session.ts`).
4. **Missing-key error is good but recovery is manual** — switching models to an unconfigured provider (openrouter) produced a clear inline error ("Missing API key for provider 'openrouter'. Add credentials in Settings, or switch providers.") but no one-click "connect this provider now" action; OpenCode's provider tip deep-links straight into connect.
5. **No paperclip/attachment affordance was discoverable in the composer** during testing even though drag-and-drop and attachment code exist (`hooks/chat-session/attachments.ts`) — verify the button renders in all composer states.
6. **No right-click context menu on session list items** (browser default menu appears); rename/fork/delete exist but only via other affordances.
7. Desktop send path forces `enableSpawn/enableTeams: false` while `/team` is still listed in the slash menu — either wire it or hide it.

---

## 8. Where OpenCode is weak (attack surface)

1. **No cost/token visibility anywhere** — Cline should double down on cost meters, budgets, per-session spend.
2. **No account/billing/orgs** — enterprise buyers get nothing; Cline's account + orgs + credits is a sales asset.
3. **No marketplace** — OpenCode config is JSON-file-first; Cline's one-click MCP/plugin/skill installs are far friendlier.
4. **Discoverability of its own power features is poor** — file tree/palette/status are buried behind an "Advanced" settings section; several were off by default and the slash popover showed "No matching items" in a fresh project. A guided tour or visible toolbar in Cline would beat it.
5. **Free-model onboarding is quiet about what "Big Pickle" is** — no explanation of quality/limits; Cline can do transparent free-tier framing.
6. **No tray, no scheduled/background jobs, no channels** — "agent keeps working while the window is closed" is a Cline-only story on desktop.
7. **Permission dock defaults still allowed our shell command with no prompt** in the tested config — their safety UX exists but the defaults are inconsistent; Cline can ship stricter, clearer defaults and own "safe by default".

---

## 9. Prioritized roadmap recommendation

**P0 — trust + daily-driver blockers**
1. Approval controls: un-hide Plan/Act, per-tool/per-scope auto-approve UI, safe defaults for new users.
2. Embedded terminal panel (PTY in sidecar; the Hub already manages processes).
3. Fix completion-status hang; folder-picker portal fallback/error.
4. OS notifications (turn complete / approval needed / question asked), wired to the existing tray.

**P1 — parity that compounds**
5. Git review panel (working-tree diffs decoupled from a single turn; Cline already has the diff components).
6. Command palette (sessions, commands, files — reuse `search_workspace_files`).
7. Session tabs (the thread model already supports it; chrome is the work).
8. Deep links (`cline://new-session?workspace=…&prompt=…`) + single-instance forwarding — enables web→app funnels from app.cline.bot.
9. Editable keybindings.

**P2 — differentiation**
10. Zero-credential free model in onboarding + provider-connect deep link from missing-key errors.
11. Worktree-per-session ("parallel agents on one repo" pairs perfectly with schedules + subagents once spawn is re-enabled on desktop).
12. Session sharing (Hub-hosted share URLs; OpenCode's is server-gated and rarely enabled — an open door).
13. Theme packs / i18n when the surface stabilizes.

---

## Appendix: build notes for reproducing this comparison

- OpenCode desktop requires Bun ≥ 1.3.14 (`packages/script` enforces it); this repo pins 1.3.13, so a second Bun install was used for the OpenCode tree only.
- `bun run predev` in `packages/desktop` downloads Electron, builds the server (`packages/opencode` → `dist/node`), and fetches the prebuilt CLI (`@opencode-ai/cli-linux-x64-baseline@0.0.0-next-16350`) into `resources/opencode-cli`; then `bun dev` (electron-vite) launches everything.
- `OPENCODE_TEST_ONBOARDING=1` boots OpenCode with a throwaway profile — useful for first-run testing; Cline's equivalent is Settings → General → replay new-user experience (`resetOnboarding()`).
- Cline Code ran via `bun run dev` (tauri dev) with a session DBus + `xdg-desktop-portal`/`-gtk` started manually so the `rfd` folder picker could function in the container.
