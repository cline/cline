# Gateway Desktop

A small native desktop client that connects to the locally installed
`cline-gateway` and exercises its Phase 3 behavior end to end. This is a
**validation client** for the Gateway RFC, not the final Cline Team
desktop product: its job is to expose protocol and lifecycle mistakes
early with minimal product code.

> Until Phase 4 lands real sandboxed execution, the Gateway reports
> `executionMode: "development"` and the UI shows a permanent
> "development mode — unsandboxed" warning. Nothing in this app claims
> the runtime is securely sandboxed.

## What it validates

- Gateway discovery (mode-0600 record), hello handshake, health
- Bot listing and default lead-bot selection
- Lazy session creation from the first prompt
- Immutable managed-workspace selection
- Immediate run acknowledgement (`run.start` never blocks on the turn)
- Streamed and replayed run events (durable cursor, contiguity, gaps)
- Strict FIFO turns and active-run steering
- Approvals from every attached client, first answer wins
- Interrupt and manual retry — same `runId`, new attempt, never automatic
- Canonical message-history hydration (`session.get`)
- Reconnect after app or Gateway restart (no auto-resume, no replacement sessions)
- Local diagnostics with redacted structured logs

## Architecture (three processes)

```
Tauri shell (Rust)          window, per-launch bridge secret, spawns/stops broker,
        |                   one native command: reveal diagnostics folder
        v
Bun broker (native/)        connects with @cline/gateway/client, owns the
        |                   DesktopProjection, translates the FIXED bridge
        |  loopback WS      command set, persists only UI-safe metadata + cursor
        v
Next.js webview (webview/)  renders the projection; imports NO SDK protocol
                            package (only the presentation package @cline/ui)
```

See `ARCHITECTURE.md` for the full contract. Key invariants:

- The app **never** starts, stops, upgrades, or replaces a Gateway. A
  missing Gateway is a visible state with copyable start instructions.
- Closing the window or broker never interrupts a run.
- There is no generic `invoke(method, payload)` bridge — the command
  schema is closed and typed (`shared/bridge.ts`).
- Bridge frames are capped at 1 MiB; prompt/steer text at 256 KiB; NUL
  and control characters are rejected.

## Development

Everything is Bun-first. After changing any SDK package run
`bun run build:sdk` at the repo root first.

```sh
# Full native app (macOS/Linux; requires Rust >= 1.85):
bun run dev                     # tauri dev: builds sidecar, starts webview, opens window

# Headless (no Rust): broker + webview separately
bun run dev:broker              # broker on ws://127.0.0.1:4517 with the dev bridge secret
bun run dev:web                 # webview on http://localhost:3135

# Webview-only UI states without any Gateway:
#   http://localhost:3135/?fixtures=idle|streaming|approval|failed|unavailable|incompatible
```

The app expects a running Gateway. Without LLM credentials, use the
demo Gateway (a REAL `GatewayServer` with a scripted engine):

```sh
CLINE_GATEWAY_DATA_ROOT=/tmp/gwd-demo bun run scripts/demo-gateway.ts
# in another shell (same data root so discovery finds it):
CLINE_GATEWAY_DATA_ROOT=/tmp/gwd-demo bun run dev
```

Demo engine behavior: every prompt streams a scripted response; a
prompt containing `fail` fails its first attempt (exercises manual
retry); a prompt containing `approve` first requests tool approval.

### Second client fixture

Multi-client behavior (shared event stream, FIFO admission,
first-approval-wins) can be exercised with the headless fixture:

```sh
CLINE_GATEWAY_DATA_ROOT=/tmp/gwd-demo bun run second-client -- watch
CLINE_GATEWAY_DATA_ROOT=/tmp/gwd-demo bun run second-client -- prompt "hello from the second client"
CLINE_GATEWAY_DATA_ROOT=/tmp/gwd-demo bun run second-client -- approve-all
```

## Tests

```sh
bun run test        # unit + integration + boundary tests (fake Gateway port)
bun run test:e2e    # end-to-end against a REAL Phase 3 GatewayServer
bun run typecheck
```

The E2E suite (`e2e/gateway-desktop.e2e.test.ts`) starts a real
`GatewayServer` (SQLite authority, singleton lock, loopback NDJSON
protocol) per test with a scripted engine and covers the spec §15
scenarios: lazy first session with immediate ack, streaming, steer,
FIFO queue-next, interrupt, manual retry (same runId, new attempt),
approvals with first-answer-wins against a second raw client, app
restart during a run, Gateway crash recovery (no auto-resume) plus
manual retry, duplicate command idempotency, incompatible-protocol
rejection, and the bridge frame limit.

It is an opt-in local job (not yet wired into repo CI): run
`bun -F @cline/gateway-desktop test:e2e` from the repo root.

## Data locations

- App state: `~/.cline/gateway-desktop/state.json` (0600) — gatewayId,
  clientId, replay cursor, selections. Nothing else is persisted.
- Logs: `~/.cline/gateway-desktop/logs/*.jsonl` — structured, redacted
  (secret-shaped keys are stripped before serialization).
- Override the root with `GATEWAY_DESKTOP_DATA_ROOT`.

The app never reads or writes the Gateway's SQLite database or session
files; the Gateway is the only persistence authority.
