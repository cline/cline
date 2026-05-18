# Menu Bar Example

macOS menu bar app built with Tauri and a Bun sidecar that monitors the shared Cline Hub.

## Prerequisites

- macOS for the menu bar/tray experience.
- Node.js 22+ and Bun.
- Rust and the Tauri 2 prerequisites for your platform. See the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/). This is required to run this example successfully.

## Spin it up

From the repository root:

```bash
cd sdk
bun install
bun run build:sdk

cd apps/examples/menubar
bun run dev
```

`bun run dev` runs `tauri dev`. Tauri first compiles the sidecar binary with `bun run build:sidecar:bin`, then launches the native app. There is no main window; look for the **Cline Hub** icon in your macOS menu bar.

## Architecture Overview

```
Any Client (CLI, VS Code, agents)
    │
    │  ws://  ui.notify / ui.show_window commands
    ▼
Hub WebSocket Server (@cline/core/hub/server.ts)
    │
    │  broadcasts ui.notify / ui.show_window events to ALL subscribers
    ▼
Menu Bar Sidecar (apps/examples/menubar/sidecar/index.ts)  ← TypeScript/Bun process
    │
    │  JSON lines on stdout: hub_state / notification / ready
    ▼
Rust Tauri App (apps/examples/menubar/src-tauri/src/main.rs)
    │
    ├── System Tray Icon with dynamic menu
    │     ● Hub Connected — 3 clients, 2 sessions
    │     ─────────────────
    │     5 notifications
    │     ─────────────────
    │     Quit Cline Hub
    │
    └── Logs notifications to stderr (with severity)
```
