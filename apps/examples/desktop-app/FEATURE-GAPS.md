# Cline Code (desktop) — feature gap analysis

A survey of what the VS Code extension (`apps/vscode`), the CLI (`apps/cli`), and the SDK
(`sdk/packages/*`) offer, measured against what the desktop app (`apps/examples/desktop-app`)
actually ships today, so the gaps can be worked as a backlog instead of rediscovered one at a
time.

Every claim below is anchored to a file path. Where a gap has an existing implementation on
another surface, that reference is listed too — most of these are porting jobs, not greenfield
design.

---

## TL;DR

The desktop app is not an empty shell. It already has chat with streaming, sessions and
history, provider/model configuration, Cline account and org switching, MCP server CRUD, the
marketplace, connectors, scheduled routines, checkpoints, attachments, file `@`-mentions,
token/cost display, a tray, and an auto-updater. The foundation is broad.

What it is missing is **depth in the control surfaces that sit around the agent loop**. The
agent runs; what a user cannot yet do is constrain it, review it, or recover from it. Three
findings stand out because they are not "unbuilt features" but wiring defects in things that
were already built:

1. **Every tool call is auto-approved, and there is no way to turn that off.**
   `autoApproveTools` defaults to `true` and has no UI control anywhere, so the desktop's whole
   tool-approval subsystem — sidecar capability, WebSocket events, the `AgentApprovalCard`
   component — is unreachable at runtime.
2. **The Plan/Act toggle does not change the system prompt.** Because `autoApproveTools` is
   always true, the prompt builder is hardcoded into `"yolo"` mode regardless of which mode the
   user picked in the composer.
3. **The Cline sign-in flow drops the device code on the floor.** The flow is wired end to end,
   but the one string the user needs to see is discarded before it reaches the UI.

Details and evidence for all three are below.

---

## Fact-check: "the Cline OAuth sign-in code flow is not implemented"

Directionally right, literally not quite — and the real problem is more specific and more
fixable than "not implemented".

**What is implemented.** The desktop app can sign in to a Cline account. `run_provider_oauth_login`
(`sidecar/commands.ts`) calls `runCancellableProviderOAuthLogin` (`sidecar/oauth-login.ts`),
which calls `loginLocalProvider` from `@cline/core`. That resolves to the shared Cline auth
handler, credentials get persisted to `providers.json`, and there is real care in the
implementation — cancellation, per-provider deduping, and cleanup of dangling browser
round-trips when the transport drops. Onboarding, the Account view, and the Models settings page
all call it.

**What is broken.** The Cline handler requests **WorkOS device-code auth**
(`useWorkOSDeviceAuth: true`, `sdk/packages/core/src/auth/provider-auth-registry.ts`). A device
flow is defined by the user reading a short code from the app and confirming it matches what the
browser shows. Core produces exactly that string:

```ts
// sdk/packages/core/src/auth/cline.ts
options.callbacks.onAuth({
  url: deviceAuthorization.verificationUriComplete ?? deviceAuthorization.verificationUri,
  instructions: `Enter this code in your browser: ${deviceAuthorization.userCode}`,
})
```

The desktop app never sees it. `loginLocalProvider` builds its callbacks with
`createOAuthClientCallbacks({ onPrompt, openUrl, onOpenUrlError })` and **no `onOutput`**
(`sdk/packages/core/src/services/providers/local-provider-service.ts`). Inside
`createOAuthClientCallbacks`, `instructions` and the URL are delivered *only* via
`options.onOutput?.(...)` (`sdk/packages/core/src/auth/client.ts`), so both are silently
dropped. All the user gets is a spinner reading "Waiting for browser…"
(`webview/components/views/onboarding/onboarding-view.tsx`).

That works only while `verification_uri_complete` pre-fills the code and the browser hands the
user a one-click confirm. It fails the moment the user wants to sign in on a phone, the browser
strips the query parameter, the pre-filled page asks them to confirm the code matches, or
`openUrl` silently no-ops. There is no code to read, no URL to copy, no polling or expiry state,
and no manual-entry fallback.

Related, and worth fixing in the same pass:

- **No `onManualCodeInput`.** Nothing in the desktop app supplies it (no matches under the app).
  Providers that need a paste-the-code fallback when the loopback redirect never arrives —
  OpenAI Codex, OCA — have no escape hatch.
- **No deep-link handler.** `src-tauri/Cargo.toml` pulls in `tauri-plugin-updater` and nothing
  else; there is no custom URL scheme. The extension registers a URI handler for `/auth`,
  `/openrouter`, `/requesty`, `/hicap`, and `/task` (`apps/vscode/src/services/uri/SharedUriHandler.ts`).
  Without an equivalent, the desktop app cannot support the providers whose sign-in works by
  redirecting an API key back to the app, and cannot open a shared task link.
- **No ClinePass tile** in onboarding, which both other surfaces have
  (`apps/cli/src/tui/views/onboarding/screens.tsx`, `apps/vscode/.../onboarding/data-steps.ts`).

So: the plumbing is there and it is good plumbing. The user-visible half of the device flow was
never built.

---

## What the desktop app already has

Worth stating plainly, because it reframes the remaining work as filling in rather than starting
over.

| Area | Status |
| --- | --- |
| Chat: streaming, reasoning, abort, fork, prompt queue, steering | Present |
| Sessions: history, search, rename, favorites, delete, resume | Present |
| Providers: full catalog, custom OpenAI-compatible providers, model picker, favorites | Present |
| Cline account: credits, usage, billing, **org switching** | Present |
| MCP: server CRUD, enable/disable, stdio/SSE/HTTP, settings file | Present |
| Marketplace: MCP, skills, plugins — browse and install | Present |
| Connectors: Slack/Discord/Telegram/WhatsApp configure + start/stop | Present |
| Scheduled routines: create, edit, pause, trigger | Present |
| Checkpoints: restore | Present |
| Attachments, file `@`-mentions, workspace + git branch switching | Present |
| Token usage ring and cost display | Present |
| Tray menu, Tauri auto-updater, telemetry opt-out | Present |
| Diff view for edited files, open-in-editor | Present |

A few of these are more complete than the equivalent in the extension. Connectors and scheduled
routines have no VS Code UI at all.

---

## The gaps

Ordered by severity, not by size.

### 1. Trust and control — the agent cannot be constrained

This is the most serious cluster. A desktop agent that edits files and runs shell commands with
no user-facing brake is a hard blocker for anyone who is not already comfortable with `--yolo`.

**1.1 Auto-approve is hardcoded on with no UI.** `autoApproveTools: true` in
`webview/hooks/chat-session/constants.ts`, and the only other references anywhere in the app are
the Zod schema and the sidecar. There is no toggle, no settings row, nothing. The sidecar then
does:

```ts
// sidecar/chat-session.ts
function resolveToolPolicies(config) {
  return { "*": { autoApprove: config.autoApproveTools !== false } }
}
```

so every tool, including `run_commands` and `editor`, is auto-approved on every session.

**1.2 The approval UI is dead code.** Because of 1.1, `requestToolApproval` is never invoked. The
sidecar registers the capability (`sidecar/context.ts`), implements `poll_tool_approvals` and
`respond_tool_approval` (`sidecar/commands.ts`), broadcasts `tool_approval_state`, has unit tests
for the whole path (`sidecar/context.test.ts`), and the webview renders `AgentApprovalCard` from
`@cline/ui`. None of it can be reached by a user. Turning on 1.1 is most of the work of shipping
1.2.

**1.3 Plan/Act does not reach the prompt.** Same root cause:

```ts
// sidecar/chat-session.ts — resolveSystemPrompt
const mode = config.autoApproveTools ? "yolo" : config.mode === "plan" ? "plan" : "act"
```

`autoApproveTools` is always true, so `mode` is always `"yolo"` and `buildClineSystemPrompt`
never receives `"plan"`. The runtime still gets `mode` separately
(`mode: config.mode ?? "act"`, same file) so tool presets and the plan-mode command guard still
apply — but the model is not told it is planning. A user who selects Plan gets act-mode
instructions with plan-mode tool restrictions, which is the worst of both.

**1.4 No granularity even once a toggle exists.** The extension splits approval into read /
edit / commands / web fetch / MCP, with a max-request cap and notification settings
(`apps/vscode/src/shared/AutoApprovalSettings.ts`,
`apps/vscode/webview-ui/src/components/chat/auto-approve-menu/constants.ts`). That model is worth
porting rather than reinventing; a single boolean will not survive contact with users.

**1.5 No `.clineignore`.** No support in the desktop app and none in the SDK either — the
controller is VS Code-only (`apps/vscode/src/core/ignore/ClineIgnoreController.ts`). To be usable
from every host this needs to move into `@cline/core` first, which makes it a larger change than
it looks.

### 2. Reviewing and recovering from what the agent did

**2.1 Command output is not shown.** The chat renders the *command string* for `run_commands`
and a status line, but stdout/stderr are only surfaced when `payload?.isError`
(`webview/components/views/chat/chat-messages.tsx`). On a successful build, test run, or
migration the user sees "Running command" and nothing else. The CLI streams this into the TUI;
the extension has full terminal integration. This is the single biggest day-to-day usability gap
after auto-approve.

**2.2 Checkpoints restore but do not compare.** `restore_checkpoint` is wired; `compareCheckpoint`
is not referenced anywhere in the app. Core already implements it
(`sdk/packages/core/src/session/checkpoint-diff.ts`, exposed as `ClineCore.compareCheckpoint`).
Worth noting the extension does not call it either, so this is new product surface on both — but
"show me everything that changed since this point" is a natural fit for a desktop window.

**2.3 No retry/regenerate.** Editing a message and forking from that point is the only recovery
path (`onEditMessage` in `chat-messages.tsx`). The extension has a distinct retry action for
failed requests (`useMessageHandlers.ts`), which matters most exactly when it is missing here: a
transient provider error.

**2.4 No quote reply.** `QuoteButton.tsx` in the extension has no desktop equivalent.

### 3. Context and cost control

The token ring and cost readout exist, which makes the absent controls more conspicuous — the
user can watch the context fill up and can do nothing about it.

- **No `/compact`, and no compaction settings.** Compaction state is read back on session load
  (`readSessionCompactionState` in `sidecar/chat-session.ts`) but there is no manual trigger and
  no UI for auto-compact or for the basic/agentic strategy choice. Both exist in the extension
  (`FeatureSettingsSection.tsx`) and the CLI (`/compact`, config view).
- **Slash commands are two deep.** Only `/fork` and `/team` are built in
  (`chat-input-bar.tsx`), plus discovered skills and workflows. Missing: `/compact`, `/newtask`,
  `/deep-planning`, `/smol`, and MCP prompt commands (`/mcp:server:prompt`).
- **`/team` is a dead command.** It is advertised in the slash menu as "Start the task with an
  agent team", but `normalizeRuntimeConfig` unconditionally sets `enableTeams: false` and
  `enableSpawn: false` (`webview/hooks/chat-session/helpers.ts`). Either wire it up or remove it
  from the menu — right now it silently does nothing.
- **`@`-mentions are files only.** `search_workspace_files` backs the composer; there is no
  folder, problems, terminal, git-changes, or URL mention. The extension's taxonomy is in
  `apps/vscode/webview-ui/src/utils/context-mentions.ts`.
- **No preferred-language setting**, which the extension injects into the system prompt across 18
  languages.
- **No plan/act separate models.** One `config.model` serves both modes; the extension's
  `planActSeparateModelsSetting` lets users pair a strong planner with a cheap executor.

### 4. Customization is read-only

`extensions-view.tsx` lists rules with a name, a preview, and a path — and that is all. There is
no create, edit, delete, or enable/disable for rules. Skills and workflows can be installed and
uninstalled from the marketplace but not authored. The section headers literally print the CLI
command to use instead (`CommandBadge` → `cline config rules`), which is a reasonable stopgap and
a poor destination for a GUI product. MCP is the exception and has proper CRUD in `mcp-view.tsx`
— that view is the template for what the others should become.

### 5. MCP depth

Server CRUD is solid. Everything around it is missing, all of which the extension has in
`apps/vscode/webview-ui/src/components/mcp/configuration/tabs/installed/server-row/ServerRow.tsx`:

- **OAuth authorization for MCP servers.** Core ships `authorizeMcpServerOAuth`
  (`sdk/packages/core/src/extensions/mcp/oauth.ts`); the desktop app never calls it. The upsert
  path carefully preserves an existing `oauth` blob, so the data model is ready — there is just
  no way to create one. Any MCP server behind OAuth is currently unusable from the desktop app.
- Per-tool auto-approve, server restart, per-server timeout configuration, and the
  Resources/Prompts panels.

### 6. Native desktop affordances

The app is a Tauri window that mostly behaves like a web page. The things users expect from a
native app, and which are the reason to ship a desktop app at all, are absent:

- **No OS notifications** — no `tauri-plugin-notification`, no matches for `Notification`. A
  background agent that finishes a ten-minute task has no way to say so. This is arguably the
  highest-value item in the whole document relative to its cost, and it pairs with the tray and
  the connectors/routines features that already exist.
- **No deep links / URL scheme** (see the auth section).
- **No global hotkey** for summoning the window.
- **No native menu bar.** `MenuBuilder` in `src-tauri/src/main.rs` is used only for the tray.
- **Single window only.** Closing hides to tray; there is no second window or tab, so no way to
  watch two sessions at once — which the sessions list actively invites.
- **No command palette.** `components/ui/command.tsx` (cmdk) is vendored and exported but never
  mounted as an app-level palette. The CLI has Ctrl+P.
- **No keyboard shortcuts** beyond the sidebar toggle and Escape.

### 7. Enterprise and org

Org switching works. Everything else for a managed deployment does not: no remote config, so no
admin-locked providers, no locked telemetry, no locked YOLO setting. Shared schemas are in
`sdk/packages/shared/src/remote-config`, the extension consumes them via `RemoteConfigSection.tsx`,
and the CLI via `apps/cli/src/utils/enterprise.ts`. The desktop app has no references at all.
This is a "cannot deploy to a company" gap rather than a UX one.

### 8. Long tail

- **Routines** cannot configure delivery adapters or autonomous mode, and offer no stats or run
  history, all of which `cline schedule` supports (`apps/cli/src/commands/schedule/`).
- **Themes**: six accent colors versus the CLI's ten named themes (`apps/cli/src/tui/themes.ts`).
- **Clipboard paste of images** is unsupported (drag-and-drop and the file picker both work); no
  `onPaste` handler exists in the webview.
- **No worktrees UI** (`apps/vscode/webview-ui/src/components/worktrees/WorktreesView.tsx`).
- **No multi-root workspaces.** `workspaces` is a recent-roots switcher, not simultaneous roots.
- **No ACP support** (`--acp` in the CLI).
- **`get_chat_ws_endpoint` is a stub** that returns `""` (`sidecar/commands.ts`).
- **`sidecar/ARCHITECTURE.md` is stale** — its command table is missing many commands that
  `commands.ts` now routes.

---

## Not recommended

Parity for its own sake would be a mistake. These exist elsewhere and should not be ported:

- **Browser / computer use.** Puppeteer-driven browsing lives only in the extension
  (`apps/vscode/src/services/browser/`) and was deliberately not carried into the SDK tool
  catalog. `fetch_web_content` covers the common case.
- **Jupyter cell commands, editor code actions, "Add to Cline" from a selection, commit-message
  generation.** These are editor-context features; they have no meaning in a standalone window.
- **Dictation.** Frequently assumed to exist — it does not, on any surface. If it is wanted, it
  is new work everywhere, not a port.
- **`contributes.configuration`-style settings.** The extension deliberately keeps all settings
  in its webview; the desktop app should keep doing the same.

---

## Suggested order of work

Grouped so that each tier is independently shippable and each one unblocks the next.

**Tier 1 — correctness. These are defects in shipped features, not new features.**

1. Surface the device code, verification URL, and polling state during Cline sign-in; add a
   copy-code affordance and a manual-URL fallback. Requires threading `onOutput` (or a richer
   callback) from the sidecar through `loginLocalProvider`, plus a sign-in UI state.
2. Add an auto-approve control and default it to off. Unblocks the approval UI that is already
   built and tested.
3. Fix `resolveSystemPrompt` so Plan mode produces the plan prompt independent of the
   auto-approve setting.
4. Either wire `/team` and `/fork`'s teams path or drop `/team` from the slash menu.

**Tier 2 — the app becomes trustworthy and usable for real work.**

5. Render `run_commands` stdout/stderr in the transcript.
6. Port the granular auto-approve categories from the extension.
7. OS notifications on task completion and on approval-needed, tied to the existing tray.
8. MCP OAuth authorization, plus per-tool approve / restart / timeout.
9. `/compact` and compaction settings.

**Tier 3 — the app becomes a desktop app.**

10. Deep-link handler and custom URL scheme; use it for provider OAuth callbacks and shared task
    links.
11. Command palette (cmdk is already vendored) and a keyboard shortcut layer.
12. Rules / workflows / skills authoring, using `mcp-view.tsx` as the pattern.
13. Multi-window, or at minimum a second session window.
14. Retry/regenerate, quote reply, clipboard image paste.

**Tier 4 — reach and scale.**

15. Remote config for managed deployments.
16. Routine delivery adapters, autonomous mode, run history and stats.
17. Checkpoint compare UI.
18. Preferred language, plan/act separate models, richer `@`-mention types.
19. `.clineignore` — hoist the controller into `@cline/core` first so every host benefits.

---

## Appendix: parity matrix

`Y` present · `~` partial · `N` absent · `–` not applicable

| Capability | Desktop | VS Code | CLI |
| --- | :---: | :---: | :---: |
| Cline account sign-in | ~ | Y | Y |
| Device code shown to user | N | Y | Y |
| Manual OAuth code fallback | N | Y | ~ |
| Deep links / URL scheme | N | Y | – |
| ClinePass onboarding | N | Y | Y |
| Org switching | Y | Y | Y |
| Remote config (enterprise) | N | Y | Y |
| Auto-approve control | N | Y | Y |
| Granular auto-approve | N | Y | ~ |
| Tool approval UI | ~ | Y | Y |
| Plan/Act toggle | ~ | Y | Y |
| Plan/Act separate models | N | Y | N |
| Command output rendering | ~ | Y | Y |
| Checkpoint restore | Y | Y | Y |
| Checkpoint compare | N | N | N |
| Retry / regenerate | ~ | Y | ~ |
| Quote reply | N | Y | N |
| `/compact` + compaction settings | N | Y | Y |
| Slash command breadth | ~ | Y | Y |
| `@`-mention breadth | ~ | Y | ~ |
| Token + cost display | Y | Y | Y |
| Rules authoring | N | Y | Y |
| Skills / workflows authoring | N | ~ | Y |
| `.clineignore` | N | Y | N |
| Preferred language | N | Y | N |
| MCP server CRUD | Y | Y | Y |
| MCP OAuth | N | Y | ~ |
| MCP per-tool approve / restart / timeout | N | Y | ~ |
| Marketplace | Y | Y | ~ |
| Connectors | Y | N | Y |
| Scheduled routines | ~ | N | Y |
| Teams / subagents | N | Y | Y |
| OS notifications | N | ~ | ~ |
| Global hotkey | N | – | – |
| Native menu bar | N | – | – |
| Command palette | N | Y | Y |
| Multi-window | N | Y | – |
| Worktrees | N | Y | ~ |
| Multi-root workspace | N | Y | N |
| ACP | N | N | Y |
| Browser / computer use | N | Y | N |
| Dictation | N | N | N |
