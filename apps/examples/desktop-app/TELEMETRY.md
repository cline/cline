# Cline Code desktop telemetry

How telemetry flows through the desktop app, and the desktop-specific
events it emits. All events land in the shared OTel pipeline with
`cline_type: "desktop"`, `platform: "Cline Code"`, and `extension_version`
from this app's `package.json` (webview, sidecar, and shell ship as one
bundle from the same version, so a single version stamp covers all of
them).

## Pipeline

- The **sidecar** owns the only telemetry handle
  (`sidecar/observability.ts`, built on `@cline/core`). Its OTel
  configuration is inlined into the compiled binary at build time
  (`scripts/telemetry-define-args.ts`); run the binary with
  `--telemetry-selfcheck` to inspect what a build shipped with.
- The **webview** holds no credentials. It forwards reports to the sidecar
  over the transport via the `report_client_event` command
  (`sidecar/client-events.ts`), which enforces an event allowlist,
  per-event property allowlists, string size caps, and secret/path
  redaction — and never throws back into the transport.
  Webview reports are buffered in a bounded in-memory queue (last 100)
  while the transport is down and flushed on reconnect
  (`webview/lib/client-telemetry.ts`).
- **Opt-out**: the Settings → Telemetry toggle writes the global
  `telemetryOptOut` setting. The sidecar enforces it in one place for
  everything — its own captures via `@cline/core`, and webview reports via
  a capture-time check in `report_client_event`. The webview never gates
  reports itself.

## Events

### `sdk.error` (component: `desktop.webview`)

Webview-side errors, alongside every other SDK error in existing queries.

| Property | Description |
| --- | --- |
| `component` | Always `desktop.webview` (stamped by the sidecar relay). |
| `operation` | Where it was caught: `window.onerror`, `unhandledrejection`, `react_error_boundary`. |
| `error_type` | Error class name. |
| `error_message` | Redacted + truncated (500 chars) message. |
| `severity` | `error` for global handlers, `fatal` for error-boundary crashes. |
| `handled` | `false` for global handlers, `true` when the error boundary contained it. |

Fired by the global `error`/`unhandledrejection` window hooks and the
top-level React error boundary
(`webview/components/webview-error-reporting.tsx`).

### `desktop.command_failed` (component: `desktop.webview`)

A transport command observed failing from the webview side, including the
"Desktop command timed out waiting for <command>" path.

| Property | Description |
| --- | --- |
| `component` | `desktop.webview`. |
| `command` | The transport command name (validated against `[a-z0-9_.]{1,64}`). |
| `duration_ms` | Time from invoke to failure. |
| `reason` | `timeout` (no response within the deadline), `transport_unavailable` (socket down/closed/send failed), or `error` (the sidecar answered with an error). |
| `transport_state` | Client transport state at failure time (`connecting`, `connected`, `reconnecting`, `unavailable`). |

Fired by the instrumentation in `webview/lib/desktop-client.ts` on every
failed command round-trip (except `report_client_event` itself, to avoid
feedback loops).

### `desktop.command_failed` (component: `desktop.sidecar`)

The server half of the same coin: a command handler threw inside the
sidecar. A webview timeout only says the sidecar didn't answer; this says
what the handler actually did.

| Property | Description |
| --- | --- |
| `component` | `desktop.sidecar`. |
| `command` | The transport command name (validated against `[a-z0-9_.]{1,64}`). |
| `duration_ms` | Handler execution time. |
| `error_type` | Error class name. |
| `error_message` | Redacted + truncated (500 chars) message. |

Fired by `sidecar/command-telemetry.ts`, which wraps every command dispatch
in `sidecar/server.ts`. Payload contents are never included.

### `desktop.command_slow` (component: `desktop.sidecar`)

A command handler succeeded but took longer than 10 s — the event that
turns a webview "timed out" mystery into "which command, how slow".

| Property | Description |
| --- | --- |
| `component` | `desktop.sidecar`. |
| `command` | The transport command name. |
| `duration_ms` | Handler execution time. |

Commands that legitimately block on interaction or long flows are exempt:
`pick_workspace_directory` (native folder picker),
`run_provider_oauth_login` (browser OAuth flow), and
`chat_session_command` (chat turns are long-running by design). Handler
*failures* of those commands still report `desktop.command_failed`.

### `desktop.shell_breadcrumb` (component: `desktop.shell`)

Process-death evidence. When the sidecar cannot spawn or dies
unexpectedly, no JS process is alive to report telemetry — so the Rust
shell (`src-tauri/src/main.rs`) appends a JSON line to a breadcrumb file
(`~/.cline/data/desktop/shell-breadcrumbs.jsonl`, capped at 64 KiB). On
the next sidecar boot, `sidecar/shell-breadcrumbs.ts` reads the file,
reports each valid line, and truncates it; malformed lines are dropped
silently and only the newest 50 lines report.

| Property | Description |
| --- | --- |
| `component` | `desktop.shell`. |
| `breadcrumb_event` | `sidecar_exited` (tracked child died without a shutdown request), `sidecar_spawn_failed` (the shell could not start the sidecar), or `sidecar_wait_failed` (the child's state could not be read). |
| `occurred_at` | When the shell wrote the breadcrumb (ISO timestamp) — the event itself is captured at next launch. |
| `exit_code` | The sidecar's exit code, when the OS reported one. |
| `restart_count` | How many unexpected exits this shell process has observed. |
| `detail` | Spawn-failure message (redacted + truncated). |
