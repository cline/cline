# Computer-use tool

Bridges Anthropic's [computer-use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
to an external screen-capture/input backend (developed out-of-tree, in Rust)
over a small JSON-L socket protocol.

This is a genuine `@cline/core` extension: `createComputerUseTool()` returns
a plain `AgentTool`, the same contract used by every other tool in
`sdk/packages/core/src/extensions/tools/`. Any host that builds a
`CoreSessionConfig` (CLI, the VSCode adapter, a future standalone script,
...) can add it via `config.extraTools` — see `createComputerUseToolFromEnv()`
in `env.ts` for the zero-config way to opt in from `CLINE_COMPUTER_USE_PORT`.

This folder is deliberately isolated from the rest of `@cline/core`:

- It only imports `AgentTool`/`AgentToolContext`/`createTool` from
  `@cline/shared`.
- It has no dependency on MCP, the plugin-sandbox system, or any
  host-specific services.

This makes it straightforward to lift into a real out-of-tree Cline plugin
later (see `sdk/packages/core/src/extensions/plugin/`) without touching call
sites beyond wherever it's added to `extraTools`.

## Why not MCP?

MCP is Cline's real plugin/tool-integration mechanism, and it was
considered. It was not used here because:

- MCP requires a JSON-RPC 2.0 handshake (`initialize`/`initialized`),
  capability negotiation, and a tool-discovery round trip before the first
  real call can be made. None of that is useful for a single, fixed tool
  (`computer`) talking to a single, purpose-built backend process.
- MCP's transports (stdio framed messages, or SSE/HTTP) add either process
  lifecycle management or an HTTP server to what is fundamentally a
  low-latency "send an input event, get a screenshot back" loop, called on
  essentially every model turn during a computer-use session.
- MCP tool names get namespaced (`server__tool`) and go through the generic
  `McpHub`/`createMcpTools` plumbing (see `sdk/packages/core/src/extensions/mcp/`),
  which is the right call for arbitrary third-party servers but is extra
  indirection for a first-party, tightly-coupled bridge.

A direct socket client keeps the round-trip cost to "one write, one read"
and keeps the protocol trivial to implement in Rust with just `tokio::net`
and `serde_json` — no MCP SDK dependency needed on the Rust side. If/when
this becomes a real out-of-tree plugin, it can still register as a normal
`AgentTool` from a plugin's `setup()`; moving away from MCP was about
avoiding protocol overhead, not about avoiding the plugin system.

## Wire protocol

- **Transport:** plain TCP to `127.0.0.1:<port>` (loopback only). TCP is used
  instead of a Unix domain socket / Windows named pipe so the exact same
  client code works unmodified on Windows, macOS, and Linux.
- **Framing:** newline-delimited JSON ("JSON Lines" / JSON-L). Every request
  or response is exactly one JSON value serialized on one line, terminated
  by `\n`. No `Content-Length` headers, no multipart framing — this is the
  simplest framing that still works correctly, since JSON string values
  always escape embedded newlines.
- **Multiplexing:** every request carries a numeric `id`; the backend must
  echo it back on the matching response. The client does not assume
  in-order responses.

### Request (Cline -> backend)

```jsonc
{
  "id": 1,
  "action": "screenshot" | "cursor_position" | "mouse_move" | "left_click" |
            "left_click_drag" | "right_click" | "middle_click" |
            "double_click" | "triple_click" | "left_mouse_down" |
            "left_mouse_up" | "key" | "hold_key" | "type" | "scroll" |
            "brief_pause" | "wait" | "zoom" | "run_sequence" |
            "mark" | "list_marks" | "flipbook" | "clear_marks" |
            // Internal query, not one of Anthropic's `computer` tool
            // actions. Sent once at startup to build the tool's
            // description/schema with the real, native display size
            // instead of a guessed default. See "Display size" below.
            "get_display_info",
  "coordinate": [x, y],            // optional, pixel coordinate
  "startCoordinate": [x, y],       // optional, for left_click_drag
  "text": "hello world",           // optional: text for "type", key combo
                                   // (e.g. "ctrl+alt+delete") for "key" /
                                   // "hold_key" — matching the backend's
                                   // serde types (qwanban computer_use.rs)
  "durationSeconds": 0.5,          // optional, for "hold_key" / "wait"
  "scrollDirection": "down",       // optional, for "scroll"
  "scrollAmount": 3,               // optional, for "scroll"
  "region": [x0, y0, x1, y1],     // optional, for "zoom"
  "expectUnchanged": [x, y, width, height], // optional click guard
  "label": "Editor open",          // required for "mark"
  "name": "load-file",             // required for "flipbook"
  "marks": [1, 3] | "2-5" | "3-",  // optional for "flipbook"/"clear_marks"
  "actions": [                    // required for "run_sequence", 1–20 steps
    { "action": "mouse_move", "coordinate": [x, y] },
    { "action": "key", "text": "Return" }
  ]
}
```

`brief_pause` waits for a fixed 300 ms and then returns a screenshot. Use it
inside `run_sequence` after opening transient UI and before typing into it.

`mark` saves the most recent screenshot and a short label to disk under
qbt's artifact root and answers with the PNG path; it is the one mark action
allowed as a `run_sequence` step. `list_marks` numbers the pending marks.
`flipbook` encodes all or a `marks` selection of them into a captioned
animated WebP (half-size frames, 1 fps, the last frame held 3.5 s) and
answers with its path and the path of each full-size frame. `clear_marks`
deletes pending marks. These three answer with text, so they are rejected
inside `run_sequence`. Marks live on disk, so they survive a backend
restart; qbt's `--artifact-root` (default: its working directory) decides
where. See qwanban's README for the on-disk layout.

The `computer` tool validates input before recovery or network activity. A
single action or sequence has a maximum 120-second estimated work budget:
explicit `wait`/`hold_key` durations, 90 ms per Unicode code point typed, 300 ms
per `brief_pause`, and 250 ms per action. A sequence shares this aggregate
budget across its 1–20 steps. Each duration must be finite and between 0 and
120 seconds; the aggregate limit still applies (a lone wait can be at most
119.75 seconds after its overhead). The action response has a 150-second
timeout: 120 seconds of work plus 30 seconds for execution and capture.
Backend recovery and connection setup have separate wait budgets.

`shutdown_backend` is an internal recovery request sent as the first frame on
a fresh control connection, so it bypasses the ordinary action queue. qbt
acknowledges it, then shuts down its agent and observatory listeners and exits
cleanly. Cline uses this only for an explicit forced restart; normal computer
actions never stop a responsive backend.

### Response (backend -> Cline)

```jsonc
{
  "id": 1,
  "ok": true,
  "text": "optional human-readable result (e.g. cursor position)",
  "image": {                       // present for "screenshot" and any
    "data": "<base64>",            // action that returns a fresh screenshot
    "mediaType": "image/png"
  },
  "display": {                     // present for "get_display_info"
    "widthPx": 1920,
    "heightPx": 1080
  }
}
```

On failure:

```jsonc
{ "id": 1, "ok": false, "error": "description of what went wrong" }
```

A refused guarded click returns `ok: true`, `aborted: true`, explanatory `text`, and a fresh `image`. Here `ok` means the request was handled, not that a click occurred. A sequence stops at that step and returns the refusal under the sequence's request id. Guards compare against the last full screenshot sent on the same connection, not intermediate sequence screenshots. Without a full reference (including after a zoom), a guarded click is refused and returns a new full screenshot. This is a visual-change check, not a lock on the desktop: the screen can still change between the check and input delivery.

See `protocol.ts` for the exact TypeScript types and `client.ts` for the
client-side framing/pending-request implementation.

## Display size

The `computer` tool's description embeds the display's pixel dimensions,
which Anthropic's model uses to reason about coordinates. The backend is the
one actually capturing the screen, so it — never configuration — is the
source of truth for those dimensions: a configured value that disagreed with
the real framebuffer would corrupt every coordinate the model computes.

`createComputerUseTool()` is therefore `async`: it always calls
`ComputerUseClient.getDisplayInfo()` (a `"get_display_info"` request) once at
construction time and uses the backend's reported size. There is no override.

The dimensions are still a construction-time snapshot: if the display is
resized after startup, the tool description goes stale until the tool is
rebuilt. Making the size fully dynamic needs the backend to report dimensions
per screenshot (they ride along naturally in the response) and the tool
description to stop embedding them — a wire-protocol change tracked under
"Not yet done".

## Opting in from environment variables

`createComputerUseToolFromEnv()` (`env.ts`) returns a ready-to-use tool (or
`undefined` if computer-use isn't configured for the current process) and is
also `async` for the same reason. It reads the port and host only; the backend
must already be running. The interactive CLI additionally honors the backend
command:

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `CLINE_COMPUTER_USE_PORT` | yes (enables the tool) | — | Backend TCP port |
| `CLINE_COMPUTER_USE_HOST` | no | `127.0.0.1` | Backend host |
| `CLINE_COMPUTER_USE_BACKEND_COMMAND` | no | — | Interactive CLI only: shell command that starts an absent backend before the initial display query and before computer actions. Also enables `computer_restart_backend` |

Display size is deliberately not configurable — see "Display size" above.

### Backend command

`CLINE_COMPUTER_USE_BACKEND_COMMAND` is optional in the interactive CLI: leave it unset if you manage qbt yourself. When set with a loopback backend address, the CLI probes qbt and launches the command only when a connection is refused, before constructing the computer tool and before each computer action. A timeout or reset does not prove the backend stopped, so recovery fails without launching a duplicate. The agent also gets `computer_restart_backend` to recover a backend that answers probes but cannot take screenshots. A forced restart asks a compatible qbt at the configured loopback port to shut down cleanly on a fresh control connection, or kills the process tree when Cline launched it, then starts the configured replacement. It never searches for processes by name. Restart the CLI after changing these variables.

Other SDK hosts must wire recovery explicitly: construct `ComputerBackendRestart`, call `ensureRunning()` before building the computer tool, pass it as `backendAvailability`, and register `createComputerBackendRestartTool()` separately. Share the ordinary `ComputerUseClient` between tools, recovery probes, and journal publishing; dispose recovery before closing the client. `createComputerUseToolFromEnv()` does not perform this wiring or return a restart tool.

Install qwanban's qbt on PATH from its Git repository. Plain `cargo install qbt` names an unrelated qBittorrent crate.

```sh
cargo install --git https://github.com/dominiccooney/qwanban.git qbt
```

Then configure the agent and observatory ports:

```powershell
$env:CLINE_COMPUTER_USE_PORT = '1234'
$env:CLINE_COMPUTER_USE_BACKEND_COMMAND = 'qbt serve 1234 5678'
```

Replace the executable path with your qbt installation. The first port is the agent port and must match `CLINE_COMPUTER_USE_PORT`; the second is the optional observatory WebSocket port. Add `--artifact-root <dir>` to choose where `mark` and `flipbook` write; without it qbt uses the directory it was started from, which for a Cline-launched backend is the CLI workspace.

The command runs on the CLI host through its platform shell (`cmd.exe` on Windows, `/bin/sh` on Unix), from the CLI workspace directory and with the CLI environment. Installing qbt on PATH makes executable lookup independent of that directory. Use an absolute executable path or an explicit directory change for a checkout-local build. PowerShell syntax inside the command requires an explicit PowerShell invocation. Setting `CLINE_COMPUTER_USE_HOST` does not run the command remotely.

At startup and before each computer action, the interactive CLI probes `get_display_info` first. A responsive backend is left running; when a connection is refused, the command is launched and given up to roughly two minutes to answer. Use a foreground command such as `qbt serve`, not `start` or a shell background operator, so Cline can clean up the child it owns. Cline stops its own child during disposal or failed startup, but does not adopt or terminate an independently started backend except through the explicit cooperative restart described above. Command output is discarded; reproduce the command in a terminal to diagnose startup failures.

## CLI integration

The interactive CLI registers the `computer` tool directly on the current
agent, independently of its provider. Backend recovery and driver transcript
recording share the same client in
`apps/cli/src/runtime/interactive/computer-use.ts`. The tools and recording
hooks remain installed across plan/act switches and session rebuilds.

Action lifecycles are observable (`ComputerUseClientOptions.observer`) and
cancellable (`ComputerUseSendOptions.signal`); the observability contract
that streams actions, screenshots, and transcripts to the qwanban
observatory lives in `src/extensions/computer-observability/`.

## Not yet done

- No auth/handshake — this assumes the backend is a locally-spawned trusted
  process on loopback. Do not bind the backend to a non-loopback address.
  The observatory's unauthenticated WebSocket side binds externally by design.
  Observers can read the journal and request fresh desktop screenshots, but
  cannot send keyboard or mouse input. Restrict network access to trusted
  observers; exposing it publicly exposes the desktop and transcript.
- No reconnect/backoff policy in the client; a dropped connection fails all
  in-flight requests and reconnects lazily on the next call.
- No persisted setting/UI toggle; env-var opt-in only, matching this being a
  proof of concept.
- Display dimensions are a construction-time snapshot; a resize after
  startup leaves the tool description stale. Fixing this properly means the
  backend reporting dimensions with each screenshot and the tool description
  no longer embedding a fixed size.

## Observability

The backend keeps an in-memory journal of everything observable on its host:
it records every computer action (with a full-screen PNG for screen-capturing
actions) as it executes it, and the agent host publishes its own events —
the driver transcript and session status changes — over the same socket with the
`publish_event` action. The qwanban observatory subscribes to that journal
over the backend's WebSocket port and renders the combined timeline.

On the Cline side (`src/extensions/computer-observability/`):

- `ComputerTaskArtifactRecorder` assigns one total order across sources and
  fans events into an `ArtifactEventSink`.
- `createJournalEventSink` is the sink that publishes each event to the
  backend via `publish_event`, in emission order, without ever blocking the
  action path. Hosts stop its publisher with `dispose()` before closing the
  shared client; a degraded `flush()` reports missing events but does not
  mean the send queue has stopped.
- `createTranscriptRecordingHooks` is an `AgentHooks` layer that records
  every committed message (`message-added` is the canonical commit point,
  covering user, assistant, and tool messages) as
  `transcript.message_committed`, and run start/end as
  `session.status_changed`. Tool outputs are reduced to name/ok — the
  backend already journals every screenshot once, in execution order.

The CLI wires all of this up in
`apps/cli/src/runtime/interactive/computer-use.ts`, sharing one
`ComputerUseClient` between the `computer` tool and the publisher because
the backend serves a single agent connection at a time (most recent wins).
