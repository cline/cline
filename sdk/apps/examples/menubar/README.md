### Architecture Overview

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
    ├── Hub Monitor Window (ui/index.html)
    │     ● Live hub status, uptime, clients, sessions
    │     ● Running session tracker and inspector
    │     ● Recent events and background-session launcher
    │
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

### Dev Commands

From `sdk/apps/examples/menubar/`:

- `bun run dev:ui` - run only the Hub Monitor UI at `http://127.0.0.1:3466/` with preview data
- `bun run dev` - run the full Tauri app with the real hub sidecar
- `bun run typecheck` - TypeScript check
