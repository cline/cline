# Cline desktop app

This app keeps the existing Cline React/Next.js webview and Tauri shell. Its
backend is a Gateway client, not a `ClineCore` host and not a Hub client.

## Processes

- The Tauri shell owns native window, tray, updater, project picker, and
  sidecar lifecycle concerns.
- The Bun sidecar preserves the webview's desktop command/event transport and
  translates that contract to the typed `@cline/gateway/client` surface.
- The namespaced `clinegate` process is the sole authority for bots,
  sessions, runs, messages, approvals, tools, schedules, connectors, provider
  settings, and persistence. The sidecar starts the bundled Gateway when it
  cannot discover an existing authority.
- The webview remains presentation-only. No UI component was replaced as part
  of the backend migration.

See [sidecar/ARCHITECTURE.md](sidecar/ARCHITECTURE.md) for the ownership and
transport boundary.
