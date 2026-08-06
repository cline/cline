# Cline Code vs. OpenWork — Competitive Gap Analysis (General-Purpose / Non-Technical Lens)

**Date:** 2026-08-06
**Cline Code:** `@cline/code` v0.0.8, built from this repo (`apps/examples/desktop-app`)
**OpenWork:** `@openwork/desktop` v0.18.16, built from [different-ai/openwork](https://github.com/different-ai/openwork) (Electron shell + React UI + `openwork-server`, **powered by the OpenCode engine** via `@opencode-ai/sdk` and a bundled OpenCode sidecar binary)

**Why this comparison:** OpenCode targets developers; OpenWork is an open-source "Claude Cowork" alternative that explicitly targets **non-technical users** ("Assume most end users of OpenWork are non-technical" — their `AGENTS.md`). This document compares Cline Code against OpenWork's average-person experience, from first run to advanced surfaces.

**Methodology:** Both apps were built from source and run side by side on the same Linux desktop. OpenWork's true first-run was walked end to end (fresh profile), then both apps received the identical general-purpose task against the same folder of "life admin" files (`expenses.csv`, `notes.txt`), followed by a systematic tour of OpenWork's library/settings/automations/permissions surfaces. UI findings were cross-checked against the OpenWork codebase.

---

## 1. Executive summary

OpenWork is best understood as **a consumer/knowledge-worker shell around the OpenCode engine**: it takes the same runtime we compared against yesterday and re-skins it as "your computer, but it works for you" — folder workspaces instead of repos, plain-language task cards instead of coding prompts, an editable spreadsheet viewer instead of git diffs, a skills/apps "Library" instead of tool config, and an enterprise control plane ("Den") that provisions inference, policies, and Google Workspace / Microsoft 365 capabilities to non-technical employees.

Cline Code already has most of the *plumbing* OpenWork runs on (sessions, tools, MCP, providers, schedules, channels) and a far deeper platform (accounts/credits, marketplaces, 183 providers). What it lacks is the **framing and packaging for a general audience**: a zero-credential first run, task-oriented copy, artifact-first output (rendering results as documents/tables rather than diffs), and connectors to the tools average people live in (email, calendar, docs). The gap to OpenWork is mostly a **presentation-layer and onboarding gap**, not an engine gap — which also means it is cheaper to close than the OpenCode gaps were.

Three observations matter most:

1. **OpenWork completes onboarding with zero credentials and runs real tasks on a free model immediately.** Our onboarding requires a key or account to do anything.
2. **OpenWork renders results as consumer artifacts** (formatted tables in chat, clickable file chips, an editable spreadsheet panel with Save/+Row/+Column, download/share buttons). We render the same result as a git-style diff — technically correct, emotionally wrong for a non-developer.
3. **OpenWork's ambition is the "capability" ecosystem** (Library of skills/apps/MCPs, org marketplaces, `search_capabilities`/`execute_capability` MCP that works from *any* agent). Much of it is still stubbed in the shipping app — the Library was nearly empty, automations UI never appeared, terminal wasn't reachable — so the window to beat them there is open.

---

## 2. Onboarding and first-run

### What each app does

| | Cline Code | OpenWork |
|---|---|---|
| First-run steps | Welcome → connect provider (sign-in / Cline key / BYO key) → done | Welcome → pick a folder → provider step (**skippable to free model**) → attribution survey → session |
| Zero-credential path | None — Skip lands in a composer that cannot run a turn | **Yes** — "Skip and use the free model" (OpenCode Zen `big-pickle`); tasks run immediately, with a gentle "Using the free starter model. Get frontier models with no API keys →" upsell banner |
| Framing | "Build software your way" | "Your computer, but it works for you." / "Power your first task" |
| Workspace selection | Not part of onboarding | **A folder pick is the core onboarding step** ("Authorize folder" — doubles as a permission grant) |
| Org/enterprise path | None | "Join your organization" (invite link), org server URL, forced-sign-in bootstrap policies |
| Post-onboarding hero | "What would you like to build?" + Review changes / Check for build errors cards | **"What do you need done? Describe it in plain language."** + cards: Summarize my week (email/calendar), Clean up a spreadsheet (CSV), Draft a document, Automate a web task |
| Analytics | None at first run | Attribution survey ("How did you hear about OpenWork?") |

### Assessment

- OpenWork's onboarding is the best of the three apps examined so far for a cold-start user: local-first, no account wall, the folder pick doubles as the permission model, and the free model means the first task runs ~60 seconds after install. We verified this live — the free "Big Pickle" model executed our spreadsheet task with no keys configured.
- Their provider step is a well-designed three-tier funnel: paid cloud ("OpenWork Models") → BYO key → free. Ours is two-tier (account / BYO) with no free tier, and "Skip for now" is a dead end.
- Their hero copy and suggestion cards are the single clearest "for the average person" signal. Ours ("build", "PRs", "/commands", "build errors") assumes a developer. Note the hero verb in our welcome rotates (build/fix/know) but every suggestion is still code-centric.
- The attribution survey is a growth tactic worth copying (skippable, one click, feeds acquisition analytics).

**Opportunities**
1. Zero-credential free model at onboarding (same recommendation as the OpenCode analysis, but OpenWork proves the exact funnel: free tier → visible upsell banner in the composer).
2. Make workspace/folder selection an onboarding step and frame it as a *permission grant* ("Cline can only see this folder") — trust framing that non-technical users understand.
3. Audience-aware welcome: detect (or ask) "what do you want help with today?" and swap suggestion cards between developer tasks and general tasks. This one screen is most of OpenWork's perceived "general-purpose-ness".

---

## 3. The same task in both apps (general-purpose lens)

Task, identical in both, against the same folder containing `expenses.csv`:
`Read expenses.csv and create expenses-summary.csv with total spending per category. Then tell me which category I spend the most on.`

| Dimension | Cline Code | OpenWork |
|---|---|---|
| Result | Correct totals, correct answer | Correct totals, correct answer (on the **free** model) |
| Answer formatting | Plain text bullets | **Formatted table** ($ signs), plus an insight sentence ("groceries… more than double your next-largest category… 48% of total spending") |
| File output surfacing | Diff panel: "Uncommitted changes", git-style `+` lines | **File chips inline in the transcript** ("FILES: expenses-summary.csv") |
| Clicking the output file | Text diff with Open in editor | **Spreadsheet editor panel**: real table grid, column headers, `+ Row` / `+ Column`, Edit, Save/Discard, download, share, byte size |
| Tool call rendering | Timeline: "Ran 1 command. Read 1 file", "Created expenses-summary.csv" | Collapsible "Thought ✓ / Read 1 file / Ran 1 command" rows with interleaved reasoning prose |
| Approvals | None (silent auto-approve default) | None observed either — the folder authorization at onboarding scopes access, and the server's approval mode defaulted to auto in this build (their approval modal with once/always/reject exists in code: `permission-approval-modal.tsx`) |
| Speed | ~5 s | ~5 s |

### Assessment

- Capability parity: the engine work is equivalent (unsurprising — OpenWork *is* OpenCode underneath). The differentiation is entirely in **how results are presented**.
- "Uncommitted changes +5 −0" is developer-native; "here's your spreadsheet, click to open and edit it" is human-native. For the PM's audience question, this is the core gap: **Cline Code has no artifact concept** — no file chips in the transcript, no preview/edit surface for CSV/Markdown/HTML/PDF output, no download/share affordance. OpenWork ships all of these (`domains/session/artifacts/`, incl. `artifact-spreadsheet-editor.tsx`).
- OpenWork's answer style (tables, computed percentages) reads like a deliverable; ours reads like a commit message. Some of this is prompting/system-prompt framing rather than UI.
- Neither app prompted for approval on this task — but OpenWork can at least argue its folder-authorization model covers scope. We simply default to YOLO (documented in the OpenCode analysis; applies equally here).

**Opportunities**
1. **Artifacts panel** (highest-leverage item in this document): file chips on assistant messages for files created/modified in the turn, with preview (markdown/CSV-as-table/HTML/image/PDF) and open/download actions. A read-only viewer is 80% of the value; the editable spreadsheet is the flourish.
2. Deliverable-style final answers for non-code tasks (render tables, currency, summaries) — largely a system-prompt/rendering investment, not new infrastructure.
3. Keep the diff panel as the *developer* view; show artifacts as the *default* view and the diff behind a toggle when the workspace is not a git repo. (Our diff panel is literally headed "Uncommitted changes" even in a folder that isn't a repo — noticed during testing; OpenWork shows "no-git" quietly in the footer instead.)

---

## 4. Where OpenWork is ahead (for the average-person use case)

1. **Zero-credential onboarding + free model** — verified working end to end (§2).
2. **Artifacts: file chips, previews, editable spreadsheet, download/share** (§3).
3. **Plain-language task framing** — hero copy, non-dev suggestion cards, "Run task" button instead of a send arrow, "Default agent / Build / Plan" agent picker with friendly names.
4. **Folder-authorization permission model** — "Authorized folders" settings panel; the workspace pick *is* the security story a lay user can understand. Cline has no user-visible statement of what the agent can touch.
5. **Connected-services strategy** — Google Workspace and Microsoft 365 as native org-level connectors, Telegram pairing, plus an MCP quick-connect catalog (Notion, Linear, Sentry, Stripe, Context7) in code (`MCP_QUICK_CONNECT` in `app/constants.ts`). "Summarize my week from email and calendar" is their flagship suggestion — no equivalent exists in Cline Code. (Caveat: most of this requires their Den cloud; in our local build the catalog didn't render.)
6. **The OpenWork Connect MCP** — one remote MCP URL (`api.openworklabs.com/mcp/agent`) exposing exactly two tools (`search_capabilities`, `execute_capability`) so users can reach their skills/connections *from any agent* (Claude Code, Cursor, Codex, OpenCode). Strategically clever: it makes OpenWork the capability layer rather than competing head-on as a chat app.
7. **Voice Mode and Computer Use extensions** (both marked Preview; voice needs an OpenAI Realtime key, computer-use is macOS-only) — signals of a "do things for me on my machine" roadmap beyond coding.
8. **Enterprise Den control plane** — org policies for desktops (allow/deny custom providers, gate the free model, pin versions, override onboarding prompts), provisioned inference, marketplaces with per-team assignment, SSO/SCIM. This is aimed at rolling agents out to *non-technical employees*, a market our Channels/Schedules don't address by themselves.
9. **Environment-variable pickup** — like OpenCode, it inherited `OPENROUTER_API_KEY` (and amusingly surfaced our `CLINE_API_KEY` as a "ClinePass" provider) with a clear "Managed by env" label in settings. Cline's provider settings don't show env-sourced credentials distinctly.

---

## 5. Where Cline is ahead (and OpenWork is thinner than it looks)

Hands-on, several headline OpenWork features were stubs or cloud-gated in the shipping desktop build:

1. **Library was nearly empty** — All/Connections/MCPs/Skills/Plugins tabs showed "No library items found"; only OpenWork Browser, Voice Mode (Preview), and Ollama appeared. The Notion/Linear/Stripe quick-connect catalog exists in code but didn't render locally. Cline's marketplaces (149 MCP servers, plugins, skills) are live today and work without any cloud account.
2. **Automations are Den-dependent** — the Preferences toggle says "Den keeps the schedule and this signed-in desktop executes"; enabling it produced no UI in our local build. Cline's Schedules run locally through the Hub today (cron/one-time, mode, workspace, parallelism).
3. **No embedded terminal reachable** (their terminal dock exists in code but wasn't discoverable/enabled; remote terminals "not wired yet"). Neither app effectively has this today; still an open gap for both vs OpenCode proper.
4. **No cost/token visibility** in OpenWork at all. Cline shows tokens, cost, and a context meter.
5. **Provider depth** — OpenWork's BYO list is the OpenCode set surfaced through a modal; Cline has 183 providers with full config forms, org accounts, credits/billing.
6. **Session power features** — Cline's checkpoints/restore, edit-earlier-message rewind, fork, reasoning-effort control, and message queue have no OpenWork equivalents in the current UI (their steer/queue exists in the composer, but no checkpoints).
7. **Recovery/settings honesty** — OpenWork's Recovery tab shows three operations all labeled "not yet available"; the Advanced tab is a wall of runtime diagnostics that undercuts the non-technical positioning.
8. **Channels** — Cline's Slack/Discord/Telegram/WhatsApp connectors are shipped; OpenWork's messaging story is Telegram-via-Den plus Slack-as-custom-MCP, with the rest "Exploring".
9. **Shared CLI/desktop state** — Cline Hub state is shared with the CLI; OpenWork has no CLI of its own (the "any agent" story goes through their cloud MCP instead).

---

## 6. Settings and configuration surfaces

| Dimension | Cline Code | OpenWork |
|---|---|---|
| Organization | Settings (General/Models/Channels/Schedules/Account) + Customizations (Plugins/Skills/MCP/Hooks/Rules/Agents/Tools) | Hub → Workspace (Preferences/Permissions/Library/Advanced) + Global (AI Providers/Cloud/Appearance/Environment/Updates/Recovery) |
| Audience fit | Developer-leaning but navigable | Split personality: Preferences page is consumer-clean (notifications, privacy, memory-bank and automations toggles); Advanced page is raw engine diagnostics |
| Providers | 183 with full forms | OpenCode provider set; env-backed providers labeled "Managed by env"; org-provisioned models via Den |
| Permissions | None visible | **Authorized folders** panel (+ approval modal in code) |
| Env vars | None | User env-var table with reserved-prefix validation |
| Update channels | Single | Stable/alpha, org-policy gated |
| Memory | None | "Memory Bank (preview)" per-user durable-facts store (cloud, flag-gated) |
| Appearance | Dark mode, 6 accents, 4 icons | System/Light/Dark, language dropdown, sidebar/menu-bar toggles (fewer themes than us — and far fewer than OpenCode's 37) |

Notable idea worth stealing: OpenWork's **Environment settings page** (user-managed env vars passed to the engine, with reserved prefixes blocked) is a clean answer to "where do I put my `GITHUB_TOKEN`" that Cline currently has no UI for.

---

## 7. Strategic read for the PM

- OpenWork validates the thesis that **the same agent engine can serve a non-technical market with mostly presentation-layer changes**: folder workspaces, plain-language framing, artifacts, free-model onboarding, and managed connectors. They did it on top of OpenCode in ~7 months of public history.
- OpenWork's moat attempt is not the desktop app (which is thin in places — empty library, stubbed recovery, Den-gated automations) but the **capability layer + org control plane**: publish skills/connections once, consume from any agent, govern by policy. That is aimed at the Claude-Cowork enterprise budget.
- Cline's fastest credible response is not a second app; it is making Cline Code **audience-adaptive**: free-model onboarding, artifact-first rendering for non-repo workspaces, folder-permission framing, and 2–3 flagship non-dev connectors (Google Calendar/Gmail summarization is the obvious first, given Channels infrastructure already exists). Our platform assets (marketplaces, schedules, channels, accounts) then become differentiators OpenWork can't match locally.
- Where we should *not* chase them: macOS computer-use and voice are preview-quality; Den-style org policy is enterprise-sales-driven and premature for a v0.0.x app.

### Prioritized recommendations (general-purpose track, complements the OpenCode P0–P2 list)

**P0**
1. Artifacts panel: file chips + previews (markdown, CSV table, image, PDF) with open/download; default view for non-git workspaces (diff stays for repos).
2. Zero-credential free model in onboarding + composer upsell banner (identical funnel OpenWork ships).
3. Folder-permission framing: show "authorized folder" language at workspace pick and in settings.

**P1**
4. Audience-aware welcome: general-purpose suggestion cards ("Summarize this folder", "Clean up a spreadsheet", "Draft a document from my notes") alongside dev cards; pick set by workspace type or a one-time question.
5. Deliverable-style answers for non-code tasks (tables/currency in final messages).
6. Environment-variables settings page.
7. Editable spreadsheet/table artifact editor (the "wow" tier of #1).

**P2**
8. Gmail/Google Calendar (and later M365) read-only connectors powering a "Summarize my week" flagship task.
9. Evaluate a "Cline capability MCP" analogous to OpenWork Connect (expose user's skills/MCPs/workflows to other agents via one endpoint) — leverages the existing marketplace instead of building a new cloud.
10. Memory bank (they flag-gate it too; watch rather than chase).

---

## 8. Bugs and paper cuts observed (both apps)

**Cline Code**
- The diff panel is headed "Uncommitted changes" even when the workspace folder is not a git repository (my-work has no `.git`); for non-repo folders the framing should be "Files created/changed".
- (Carried from the OpenCode analysis: silent YOLO default, hidden Plan/Act, no OS notifications — all equally relevant to a non-technical audience, arguably more so.)

**OpenWork**
- Automations toggle enables nothing visible locally (Den-dependent; no explanatory empty state).
- Library tabs mostly empty with generic copy; quick-connect catalog didn't render in the local build.
- Recovery settings: three operations, all "not yet available".
- "Cloud provider sync failed" banner in AI Providers when not signed in to Den.
- Duplicate file chips for the same artifact in the FILES row.
- Permission approval modal exists in code but never fired for bash in the default local configuration.

---

## Appendix: build notes for reproducing

- OpenWork is a pnpm monorepo (`pnpm@11.4`, Node 22). `pnpm install` then `pnpm dev` (→ `apps/desktop/scripts/electron-dev.mjs`): downloads the OpenCode sidecar binary (v1.17.11 from `anomalyco/opencode`), builds `openwork-server`, starts Vite on :5173, launches Electron. On Linux set `ELECTRON_DISABLE_SANDBOX=1`; `OPENWORK_ELECTRON_USE_MOCK_KEYCHAIN=1` avoids keychain prompts.
- Dev profile data lands in `~/.config/com.differentai.openwork.dev/`; workspaces are plain user-picked folders.
- The engine inherits shell env: `OPENROUTER_API_KEY`/`CLINE_API_KEY` surfaced automatically as providers ("Managed by env").
- The free-model path (OpenCode Zen `big-pickle`) worked with zero configuration at test time.
