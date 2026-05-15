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
    ├── System Tray Icon with dynamic menu
    │     ● Hub Connected — 3 clients, 2 sessions
    │     ─────────────────
    │     5 notifications
    │     ─────────────────
    │     Quit Cline Hub
    │
    └── Logs notifications to stderr (with severity)
```
