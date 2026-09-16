# Cline Hub

> Support-agent reference. Grounded on `main` @ `025baa8fb76d9bdb8a351177bc51b6c2721e18fa` (github.com/cline/cline).

## What it is

"Cline Hub" has two related surfaces on main — conflating them is the most common support confusion:

1. **The hub daemon** — a singleton background process per machine that coordinates session state, event routing, approvals, schedules, and client-owned capabilities. Per `docs/sdk/architecture/hub-spoke.mdx`: "A background daemon (the hub) coordinates session state and event routing ... Does not run the agent loop" (the connected clients — "spokes" — and hub-hosted runtimes do the agent work). The daemon is implemented inside **`@cline/core`** under `sdk/packages/core/src/hub/` (`daemon/`, `server/`, `client/`, `discovery/`), exported as `@cline/core/hub` and `@cline/core/hub/daemon-entry`.
2. **`@cline/cline-hub` (`apps/cline-hub`)** — a private, unpublished **browser dashboard** for that daemon: "Browser dashboard for the Cline hub: live clients, sessions, streaming chat, and hub restart" (`apps/cline-hub/package.json`). It is bundled into the CLI and launched with `cline dashboard`.

## Why it exists (product terms)

The hub lets multiple clients (CLI, desktop app, menubar, VS Code example extension, connectors) share the same sessions: hosts "attach and detach from shared sessions without stopping the authority runtime, so another client can keep streaming or resume the same session later" (`sdk/ARCHITECTURE.md`, "Hub-Backed Runtime"). It also powers background execution (`cline --zen`), schedules/automation, connectors, the agenda task queue, and desktop app features.

## Lifecycle

- **Auto-spawn:** clients using `ClineCore` start the daemon automatically when needed via `ensureDetachedHubServer` / `spawnDetachedHubServer` (`sdk/packages/core/src/hub/daemon/index.ts`; child runs with `CLINE_RUN_AS_HUB_DAEMON_ENV=1`). The CLI's interactive TUI uses `backendMode: "auto"` — it reuses a compatible hub immediately, prewarms a missing one in the background, and falls back to a local in-process runtime for responsiveness (`sdk/ARCHITECTURE.md`, "Interactive CLI Startup"). Hub-required flows (`cline hub`, schedules, connectors, `--zen`) ensure a live hub explicitly.
- **CLI management** (`apps/cli/src/commands/hub.ts`): `cline hub ensure`/`start`, `cline hub status` (JSON with `running`, `url`, `pid`, `startedAt`, `uptime`, `cliVersion`, `coreVersion`), `cline hub stop`, `cline hub drain [--off]`, `cline hub upgrade` (drain → wait idle → stop → ensure fresh).
- **Upgrade safety:** SDK builds embed a build fingerprint and epoch; a managed daemon from an older build is retired and replaced, while a *newer* compatible daemon is reused and the client prompts the user to update (`sdk/ARCHITECTURE.md`).

## Transport, ports, auth

| Endpoint | Default | Source |
|---|---|---|
| Hub WebSocket | `ws://127.0.0.1:25463/hub` (prod), port `25466` in dev | `sdk/packages/shared/src/rpc/index.ts`, `sdk/packages/core/src/hub/discovery/defaults.ts` |
| Overrides | `CLINE_HUB_HOST`, `CLINE_HUB_PORT`, `CLINE_HUB_PATHNAME`, `CLINE_HUB_ADDRESS` | same |
| Dashboard | `http://127.0.0.1:8787` (`CLINE_HUB_DASHBOARD_PORT`), Vite dev webview on `5173` | `apps/cline-hub/README.md` |
| Daemon log | `~/.cline/logs/hub-daemon.log` | `docs/sdk/architecture/hub-spoke.mdx` |

Local auth: on startup the hub server generates a per-process random auth token stored in an owner-only discovery record; clients resolve it from the discovery file at connect time. Unauthenticated processes can probe health/build metadata but cannot attach to sessions, issue commands, or stop the daemon (`sdk/ARCHITECTURE.md`). Bad auth yields HTTP `401 Unauthorized` on the WebSocket upgrade — unrelated to LLM-provider "Unauthorized" errors.

## What the hub manages

- Session brokering, event fan-out (structured streaming lifecycle events, `tool.updated`, `assistant.media`, `settings.changed`), approvals, and client-contributed tool executors.
- Session persistence: SQLite index + JSON snapshots under `~/.cline/data/sessions/` (`docs/sdk/architecture/hub-spoke.mdx`).
- Schedules/cron and event-driven automation (specs under `~/.cline/cron/` and workspace `.cline/cron/`; `cron.db`).
- The agenda task queue (`~/.cline/tasks/*.task.md`, `tasks.db`; `task.*` hub commands) — note the agent-facing `kind: "todo"` tool half and desktop Agenda UI are temporarily feature-flagged off on main (`sdk/ARCHITECTURE.md`, "Hub-Owned Agenda Task Queue").
- Connector autostart/reconnect (the detached daemon is the sole startup reconnect owner).
- Agent Plugin enablement state (see [agent-plugins.md](./agent-plugins.md)).
- Settings snapshots/mutations via `settings.list` / `settings.toggle`.

## How clients connect

- **CLI:** bundles the hub code via `@cline/core`; `--zen` submits a task to the daemon and exits (the menubar app, if running, surfaces a notification on completion via hub `ui.notify`).
- **Desktop app:** its Bun sidecar connects with `backendMode: "hub"`, `hub.strategy: "require-hub"`, client type `code-sidecar` (`apps/examples/desktop-app/sidecar/context.ts`).
- **SDK hosts:** `NodeHubClient`, `HubSessionClient`, `HubUIClient`, `connectToHub` from `@cline/core/hub`.

## The dashboard app (`apps/cline-hub`)

Private workspace package (`@cline/cline-hub`, version 0.0.0, no npm `bin`). Started via `cline dashboard` or `bun run start` in `apps/cline-hub`. Capabilities (`apps/cline-hub/README.md`): live list of connected hub clients and active sessions, view/drive a session from a chat box, start new sessions (provider/model reused from the most recent session or `CLINE_PROVIDER`/`CLINE_MODEL` env), and a **Restart Hub** button (graceful stop + fresh respawn; sessions on the old hub stop, other clients reconnect on next request). Optional LAN/tunnel exposure is gated by `ROOM_SECRET` (required when `HOST=0.0.0.0`); the README explicitly warns it is "an example dashboard, not a production admin tool".

## Naming collisions to watch in support

- **`McpHub`** (`apps/vscode/src/services/mcp/McpHub.ts`) is the VS Code extension's MCP connection manager class — nothing to do with the hub daemon.
- The MCP **marketplace** in docs is not called "hub" on main.
- `docs/hubspot.js` is unrelated analytics.
