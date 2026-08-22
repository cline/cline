# Cline desktop app

This app keeps the existing Cline React/Next.js webview and Tauri shell. Its
backend is a Gateway client, not a `ClineCore` host and not a Hub client.

## Processes

- The Tauri shell owns native window, tray, updater, project picker, and
  installation/update of the persistent bundled local Gate service.
- The Bun sidecar preserves the webview's desktop command/event transport and
  translates that contract to the typed `@cline/gateway/client` surface.
- The namespaced `clinegate` process is the sole authority for bots,
  sessions, runs, messages, approvals, tools, schedules, connectors, provider
  settings, and persistence. Release builds install the sidecar and Gateway as
  a loopback-only user service that remains available after the desktop app
  exits. The complete `cline-dad` profile and plugin tree is bundled and used
  as the default lead.
- Debug mode can run multiple bot/workspace bridge processes, but all use the
  fixed `desktop` namespace. The Gateway namespace lock guarantees a single
  authority, and bridge shutdown never stops it.
- The webview remains presentation-only. No UI component was replaced as part
  of the backend migration.

See [sidecar/ARCHITECTURE.md](sidecar/ARCHITECTURE.md) for the ownership and
transport boundary.
