# Terminal UI Examples

Two integration modes for the shared terminal UI in `@cline/ui`:

## Protocol-driven (`protocol-mode.ts`)

A thin terminal client over a `UiConnection` — the canonical, transport-neutral
UI protocol defined in `@cline/shared` (re-exported by `@cline/ui/protocol`).
The host owns the runtime and translates its events into `UiOutboundMessage`s;
the UI renders the transcript and sends user actions back as
`UiInboundMessage`s. The UI never creates sessions, touches persistence, or
knows the transport.

```bash
bun sdk/examples/terminal-ui/protocol-mode.ts
```

## Host-driven interactive (`interactive-mode.ts`)

The full Cline terminal experience (`runInteractiveTerminalUi`), configured
entirely with plain data and callbacks (`InteractiveTerminalUiProps`).
Runtime-owned surfaces — provider picker, account dialog, MCP manager,
session history, onboarding — are optional host injections
(`createHostSurfaces`); this example omits them and the UI degrades
gracefully.

```bash
bun sdk/examples/terminal-ui/interactive-mode.ts
```

Both examples script an in-process "agent" so they run without provider
credentials. The production adapter lives in
`apps/cli/src/runtime/run-interactive.ts` and `apps/cli/src/tui/host-surfaces.tsx`.
