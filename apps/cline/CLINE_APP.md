# Cline App — Design & Architecture

`apps/cline` (package `@cline/cline-app`) is the **Cline desktop application**: a
native desktop shell that runs and inspects Cline chat sessions. It is a Tauri
v2 desktop shell wrapping a **Bun sidecar backend** and a **Next.js webview UI**.
It is forked from `apps/examples/desktop-app` (package `@cline/code`, the
"Desktop App Example") and adds a **sandboxed, multi-bot backend** on top of it.

This document describes what the app does, how it is put together, and — most
importantly — how it differs from the two setups it is often compared against:

- `apps/examples/desktop-app` — the reference/sample implementation it forks.
- `apps/cli` — the terminal-based `@cline/cli` package.

---

## 1. What the App Does

The desktop app gives users a **standalone window** (not an editor panel, not a
terminal) in which to run Cline chat sessions. High-level capabilities:

- **Chat sessions** — start, attach to, send follow-ups in, fork, and stop
  Cline sessions; stream text, reasoning, tool calls, and tool approvals live.
- **Provider management** — configure providers, models, API keys (stored via
  `ProviderSettingsManager`), OAuth login, voice-input transcription settings.
- **Session history** — list, read, delete, and rename past sessions; session
  messages are persisted (SQLite + file artifacts) under `~/.cline/data`.
- **MCP servers** — list, add, delete, enable/disable, and OAuth-authorize MCP
  servers.
- **Routine schedules** — list cron/event schedules for recurring agent work
  through the shared Hub.
- **Marketplace** — browse and install MCP marketplace entries.
- **Native desktop affordances** — a menu bar / tray with status + actions
  (new session, settings, zoom), an app icon picker, window title with the
  running version, and auto-update checks (currently pointed at a placeholder
  feed — see §4.4).
- **Multi-bot identities** (unique to this app) — up to 5 named agents, each
  with a fully isolated `~/.cline/bots/<bot-id>/` data tree, creatable/switched
  from the sidebar's bot switcher.
- **Sandboxed backend** (unique to this app) — the Hub process can run inside
  an OS-native sandbox so agents have **deny-by-default filesystem access**
  limited to their own bot's data tree and the assigned workspace.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Tauri Shell (Rust)                     │
│                       src-tauri/src/main.rs                  │
│                                                              │
│  • window mgmt, tray/menu, updater, bot registry,           │
│    per-(bot, project) backend process pool                   │
│  • spawns the sandbox launcher → sidecar → Hub daemon        │
└───────────────┬─────────────────────────────────────┬────────┘
                │ spawns (via sandbox/launcher.ts)     │ serves
                ▼                                     ▼
┌─────────────────────────────┐        ┌────────────────────────────┐
│     Bun Sidecar Backend     │        │      Next.js Webview       │
│        sidecar/*.ts         │  HTTP  │        webview/*           │
│                             │  +WS   │                           │
│ • HTTP + WebSocket server   │◄──────►│ • desktop-client.ts talks  │
│ • command router (commands) │ 3125/6 │   to sidecar over WS       │
│ • ClineCore + shared Hub    │        │ • React chat UI, settings, │
│ • provider/session/MCP ...  │        │   sessions, marketplace    │
└─────────────┬───────────────┘        └────────────────────────────┘
              │ connects to (shared discovery)
              ▼
┌─────────────────────────────┐
│        Shared Cline Hub     │  (canonical Hub daemon, same one the
│        (detached daemon)    │   CLI and other clients share)
└─────────────────────────────┘
```

The three layers are intentionally decoupled:

1. **Tauri shell (Rust)** — the only place with OS-native UI/build plumbing.
   It owns the window, tray/menu, updater, and — in `apps/cline` — the
   per-bot/per-project process pool.
2. **Bun sidecar (TypeScript)** — a plain Bun HTTP+WebSocket server. It adapts
   the webview's commands to the shared Cline Hub and SDK APIs. It does **not**
   own an in-process agent runtime; it is a *client* of the canonical Hub.
3. **Next.js webview** — a React app served from the sidecar. It talks to the
   sidecar over a WebSocket (`desktop-client.ts`), with **no direct Tauri
   dependency** in the webview data path (the webview only uses the Tauri API
   for a few native niceties like window title / asset protocol).

This three-way split (native shell / backend adapter / web UI) is the same
shape as `apps/examples/desktop-app`; what distinguishes `apps/cline` is what
happens *behind* the sidecar (§3) and the multi-bot/sandbox features (§4.1–4.2).

---

## 3. The Sidecar

The sidecar is the heart of the backend. Key responsibilities (see
`sidecar/ARCHITECTURE.md` for the full command map):

- **Session management** — creates a `ClineCore` Hub-mode client
  (`clientName: "cline-code"`, `backendMode: "hub"`, `strategy: "require-hub"`)
  and streams session events to the webview over WebSocket.
- **Command router** — ~35 commands spanning chat sessions, provider catalog,
  session storage, MCP, git, workspace file search, tool approvals, routine
  schedules, voice input, and native OS dialogs.
- **Transport protocol** — request/response/event JSON over WebSocket:

  ```
  Request:  { "type": "command", "id": string, "command": string, "args"?: object }
  Response: { "type": "response", "id": string, "ok": boolean, "result"?: unknown, "error"?: string }
  Event:    { "type": "event", "event": { "name": string, "payload": unknown } }
  ```

- **Tool approvals** — when the Hub needs tool approval, the sidecar pushes a
  `tool_approval_state` event to the webview and waits on a client-owned
  in-memory promise map; the webview's response resolves it.
- **Shared discovery** — rather than owning its own Hub, it discovers/uses the
  **same compatible Hub the CLI shares**. If the desktop is the first client it
  starts the canonical detached Hub itself. `apps/cline` hardens this startup
  (retries, explicit auth-token resolution) — see §4.3.

### Sidecar key design decisions (both desktop apps)

- The sidecar is a **client** of a shared Hub, not an owner — so a desktop
  session and a CLI session in the same workspace can coexist against one Hub.
- Provider settings live behind `ProviderSettingsManager`; sessions in
  `SqliteSessionStore`; schedules via Hub `schedule.*` commands.
- The frontend connects via `window.__SIDECAR_WS_ENDPOINT__` or the default
  `ws://127.0.0.1:3126/transport` — no Tauri dependency in the webview's
  command path.

---

## 4. vs `apps/examples/desktop-app` (the fork origin)

`apps/cline` is a **direct fork** of `apps/examples/desktop-app`, and for the
most part the two are still structurally identical (same sidecar layout, same
Next.js webview, same Tauri shell, same shared-Hub model, same transport
protocol, same build/package scripts). The differences are additive:

### 4.1 Sandboxed Hub backend (`sandbox/` — the headline difference)

`apps/examples/desktop-app` runs the sidecar binary directly on the host.
`apps/cline` introduces `sandbox/launcher.ts`, an uncompiled Bun script that
Tauri spawns **instead of** the sidecar binary directly. It wraps the entire
Hub process in `@anthropic-ai/sandbox-runtime`'s OS-native sandboxing
(`sandbox-exec` on macOS, bubblewrap on Linux), giving the agent a
**deny-by-default filesystem policy** limited to:

- the active bot's own `~/.cline/bots/<bot-id>/{data,plugins,rules,skills}`
- the workspace directory passed on the command line (if any)

and a **domain-restricted network allowlist** built from the configured model
providers' API endpoints. If sandboxing is unsupported or deps are missing, it
gracefully falls back to an unsandboxed launch rather than failing to start.

The launcher also creates/evicts the per-project **Hub daemon** process: it
overrides `CLINE_HUB_DISCOVERY_PATH` so each project gets its own daemon
(which inherits the sandbox scope) rather than reusing an unsandboxed one from
another project, and derives a deterministic per-project hub port to avoid
collisions.

### 4.2 Multi-bot identities (`sandbox/bot-config.ts` + webview)

Unique to `apps/cline`:

- **Bots** are named agent identities, each with its own isolated
  `~/.cline/bots/<bot-id>/` tree, used as that process's `CLINE_DIR`. A bot's
  tree is **never seeded from the host's** `~/.cline` — it starts empty.
- Up to 5 bots coexist, tracked in the host-owned `bots/registry.json`,
  managed via the webview's **bot switcher** (`bot-switcher.tsx`,
  `use-bots.ts`). Registry state lives in the Rust shell
  (`create_bot` / `switch_active_bot`), not webview localStorage.
- Bots can be **assigned projects** (`assign_project`, stored per-bot in a
  project registry) — the backend process pool is keyed by
  `(bot_id, project_path)`.
- A **`propose_new_bot` tool** (bundled as the first-party `propose-bot`
  plugin, installed only for the default `cline` bot) lets the agent *propose*
  creating a new bot during a chat; the webview renders a review card and the
  user's click drives the existing create flow.
- **Message-bot relay** (`use-message-bot-relay.ts` + sidecar
  `requestSidecarMessageBot`) — one bot can send a message to *another* bot's
  sidecar, fire-and-forget or awaiting a reply, resolved via a shared
  claim/relay protocol across webview windows. This is implemented in the
  sidecar's `context.ts` and `server.ts` (claim handling) — absent from the
  example app.
- **Per-bot system prompts** — `system-prompt-editor.tsx` +
  `system-prompt-view.tsx` + a `commands-system-prompt.test.ts`; the example
  app has no system-prompt UI.

### 4.3 Hardened Hub client startup (`sidecar/context.ts`)

`apps/cline`'s `context.ts` is more defensive than the example's:

- **Retries** Hub-clients connect to the newly-started daemon (first connect
  can hit an accept-queue stall) — the example connects once and throws.
- **Resolves and passes the Hub auth token explicitly** to
  `ClineCore.create()` and the observer client, because `ensureCompatibleLocalHubUrl`
  returns only a URL and `ClineCore.create()`'s own `hub` options don't default
  the token in. The example relies on `create()`'s internal resolution, which
  silently passes no token on a fresh daemon.
- Uses `watchManagedHubBuildMismatch` to surface a "hub build mismatch —
  update & restart" dialog (`hub-update-required-dialog.tsx`) when another
  Cline install replaced the shared Hub daemon.
- Carries a `clientTurnId` through chat-session commands and `chat_session_ended`
  events so the webview can correlate relayed turns.

### 4.4 Packaging / identity differences

| | `apps/cline` | `apps/examples/desktop-app` |
|---|---|---|
| package | `@cline/cline-app` | `@cline/code` |
| productName | `Cline` | `Cline Code` |
| bundle identifier | `bot.cline.sandbox` | `bot.cline.app` |
| sidecar external bin | `bin/cline-sidecar` | `bin/code-sidecar` |
| updater feed | placeholder (`cline-app-latest`, pubkey `UNCONFIGURED`) — **not wired** | real `desktop-latest` feed + signing key |
| beta channel | none (no `tauri.beta.conf.json`) | `tauri.beta.conf.json` / `desktop-beta` |
| sandbox + `extensions/` dir | present (`sandbox/`, plugin bootstrap bundle) | absent |
| macOS packaging | Developer-ID gating / `--allow-unsigned-mac` (same as example) | same |

`apps/cline` deliberately does **not** reuse the example's signing key or
`desktop-latest` feed — that key/feed belongs to the already-published
`desktop-app` product. Before shipping, `apps/cline` needs its own keypair/feed
(see its README's "Releases & Auto-Updates").

### 4.5 Minor removals

`apps/cline` drops some example-app files: `EXPERIMENTAL.md`, `tauri.beta.conf.json`,
`webview/lib/app-channel.*`, and `sidecar/restore-checkpoint.test.ts` (the last
because `apps/cline` builds on a different `chat-session.ts`).

---

## 5. vs `apps/cli` (the terminal client)

The CLI (`apps/cli`, package `@cline/cli`) and the desktop app share the same
SDK + Hub substrate but present entirely different host surfaces. Key
differences:

### 5.1 What each provides as a host

| | `apps/cli` | `apps/cline` (desktop) |
|---|---|---|
| Host surface | terminal, commander subcommands, OpenTUI React TUI | native desktop window (Tauri) + Next.js React webview |
| Primary interaction | interactive TUI (`cline`) / one-shot (`cline "prompt"`) / headless (`--json`, `--yolo`, `--zen`) | GUI chat, sessions list, settings, marketplace views |
| Rendering | OpenTUI (`@opentui/core` native Zig binary + `@opentui/react` reconciler) | React 19 + Tailwind + Radix/shadcn UI in a browser engine |
| Backend process | itself; claims/serves the Hub daemon when needed; `--zen` dispatches to Hub | a dedicated Bun sidecar that is a **Hub client** |
| Backend ownership | the CLI *is* the process that can spin the hub daemon (`ensureDetachedHubServer`) | sidecar connects to the same shared Hub; never owns an in-process one |
| Native integration | none (terminal only; menubar app via connector events) | window mgmt, tray/menu, app icon, window title, directory pickers, auto-update, sandbox |
| Bot identities | none | yes (§4.2) |
| Sandboxing | optional `--data-dir` sandbox mode (mutually exclusive with `--zen`) | **default design** — Hub runs inside OS-native sandbox (when supported) |

### 5.2 How each attaches to the Hub

Both use the **canonical shared Hub** and its discovery records; that is exactly
why a desktop and CLI session in the same workspace can interoperate. The
mechanics differ:

- **CLI**: `main.ts` / `index.ts` performs a `claimHubDaemonProcess()` check —
  when the sentinel is present, the process *becomes* the Hub daemon
  (`@cline/core/hub/daemon-entry`); otherwise it runs the CLI. `ensureCliHubServer`
  / `ensureDetachedHubServer` start or reuse the detached Hub. `--zen` submits a
  turn and exits, letting the background Hub finish and publish `ui.notify`.
- **Desktop sidecar**: `ClineCore.create({ backendMode: "hub", strategy:
  "require-hub" })` with explicit endpoint + auth token; the sidecar opens an
  *observer* client (`handleHubLiveEvent`) alongside its session client to see
  cross-client events (sessions created by other clients, notifications). The
  webview is purely a display/control surface — all agent execution and
  session state live in the shared Hub.

So: **the CLI is frequently the thing that *boots* the Hub; the desktop app is
always a *guest* of it** (though it can start the same detached Hub when it's
the first client).

### 5.3 Frontend / UI differences

- The CLI's UI is the **OpenTUI terminal renderer** (Zig-compiled native
  binary), interactive for chat and headless for CI; the desktop app's UI is a
  **full Next.js browser webview** with rich components (chat bubbles, diff
  views, image lightbox, marketplace, settings sections).
- The CLI drives provider/device workflows through **wizards** (connect, mcp,
  schedule) and **slash commands**; the desktop app drives them through
  **webview views** (settings, account, sessions, marketplace, onboarding).

### 5.4 What the desktop adds beyond the CLI

- **Native desktop lifecycle** — tray/menu actions that route back to webview
  via `desktop-menu-action-pending` events; zoom in/out/reset; running-session
  count in the tray.
- **Windows/OS integration** — dock icon variants, window title synced to
  version, OS directory pickers, `open`/`xdg-open` for MCP settings file.
- **Persistent GUI session history** — a dedicated sessions view over
  `SqliteSessionStore` + file discovery.
- **Voice input** — `speech-input.tsx`, streaming transcription with
  short-lived browser tokens minted by the sidecar (credentials never reach
  the webview).
- **Multi-bot + sandbox** (see §4).

### 5.5 What the CLI has that the desktop doesn't (currently)

- **Connectors / chat adapters** — Telegram, Google Chat, WhatsApp, Discord,
  Linear, Slack (`src/connectors/adapters/`) so agents can be reached from
  messaging apps. The desktop app imports the connector *catalog* (`@cline/core`
  `listActiveConnectors`, `CONNECTOR_PLATFORMS`) and can configure connector
  channels in its UI, but it is the **Hub/CLI that supervises** connector
  processes — the desktop doesn't host them.
- **Kanban** — the TUI runs an internal kanban board
  (`src/commands/kanban.ts`, `kanban-migration/`).
- **`--zen` / headless CI modes** — terminal-only concepts; the desktop app is
  inherently interactive.
- **Auto-update of the CLI binary** itself via the Hub / `cline update`; the
  desktop's update path is Tauri's updater (disabled until configured).

---

## 6. Shared foundation (what all three environments inherit)

Everything here is ultimately a host for the same **Cline SDK + Hub**:

- **`@cline/core`** — `ClineCore`, `ProviderSettingsManager`,
  `SqliteSessionStore`, Hub client/daemon.
- **`@cline/llms`** — model/collection metadata (`MODEL_COLLECTIONS_BY_PROVIDER_ID`),
  transcription route resolution.
- **`@cline/shared`** — provider defaults, storage paths, tools (`createTool`),
  discovery records, logging/telemetry, cron.
- **`@cline/ui`** — the internal visual-system package used by the desktop
  webview (tokens + optional Tailwind adapter); the CLI is text-only.
- **File-backed storage** under `~/.cline/data/` (global state, secrets,
  sessions, workspace state) shared across environments.

So "what it does" is the same agent; the differentiator is **which host and
which UX** (native window vs browser webview in the desktop; terminal + CI in
the CLI; and, in `apps/cline` specifically, the sandbox + multi-bot layer).

---

## 7. Dev Commands (quick reference)

From `apps/cline/`:

| Command | Purpose |
|---|---|
| `bun run dev:web` | Next.js UI only (`http://localhost:3125`) |
| `bun run dev:sidecar` | sidecar backend only (`ws://127.0.0.1:3126/transport`) |
| `bun run dev` | Tauri desktop dev (builds sidecar bin + starts web) |
| `bun run build` | build web assets (Next) + sidecar binary |
| `bun run build:sidecar` | build the Bun sidecar bundle |
| `bun run build:sidecar:bin` | compile the Bun sidecar into a local binary |
| `bun run build:binary` | `tauri build` |
| `bun run package:desktop[:(mac|windows|linux)]` | package into `dist/desktop/` |
| `bun run typecheck` | `tsc -p tsconfig.dev.json --noEmit` |

All SDK deps resolve through `dist/` — run `bun run build:sdk` (repo root) after
SDK source changes before running the desktop or CLI.

---

## 8. Open items / roadmap (from the codebase)

- **Auto-update not wired** — `tauri.conf.json` updater points at a placeholder
  feed (`cline-app-latest`, pubkey `UNCONFIGURED`). Update checks fail
  harmlessly today; needs a real keypair + feed before shipping.
- **Sandbox network allowlist** is best-effort static, extended per-provider via
  `CLINE_SANDBOX_ALLOWED_DOMAINS`; some tenant-specific hosts (e.g. SAP AI Core)
  aren't covered by the static wildcard map.
- **Plugin/rules isolation gap** — the SDK also unconditionally scans
  hard-coded real-home locations (`~/Documents/Cline/{Plugins,Rules}`,
  `~/.agents/...`) that `CLINE_DIR` can't redirect; under deny-by-default this
  is *correct* for isolation but means host-side plugins never reach bots.
