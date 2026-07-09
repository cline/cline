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
            "wait" | "zoom" |
            // Internal query, not one of Anthropic's `computer` tool
            // actions. Sent once at startup to build the tool's
            // description/schema with the real, native display size
            // instead of a guessed default. See "Display size" below.
            "get_display_info",
  "coordinate": [x, y],            // optional, pixel coordinate
  "startCoordinate": [x, y],       // optional, for left_click_drag
  "text": "hello world",           // optional, for "type"
  "keys": "ctrl+alt+delete",       // optional, for "key" / "hold_key"
  "durationSeconds": 0.5,          // optional, for "hold_key" / "wait"
  "scrollDirection": "down",       // optional, for "scroll"
  "scrollAmount": 3,               // optional, for "scroll"
  "region": [x, y, width, height]  // optional, for "zoom"
}
```

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

See `protocol.ts` for the exact TypeScript types and `client.ts` for the
client-side framing/pending-request implementation.

## Display size

The `computer` tool's description embeds the display's pixel dimensions,
which Anthropic's model uses to reason about coordinates. Since the backend
is the one actually capturing the screen, it — not Cline — is the source of
truth for those dimensions.

`createComputerUseTool()` is therefore `async`: unless both
`displayWidthPx`/`displayHeightPx` are passed explicitly, it calls
`ComputerUseClient.getDisplayInfo()` (a `"get_display_info"` request) once at
construction time and uses the backend's reported size. A single override
(e.g. only `displayWidthPx`) still queries the backend for the other
dimension.

## Opting in from environment variables

`createComputerUseToolFromEnv()` (`env.ts`) returns a ready-to-use tool (or
`undefined` if computer-use isn't configured for the current process) and is
also `async` for the same reason:

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `CLINE_COMPUTER_USE_PORT` | yes (enables the tool) | — | Backend TCP port |
| `CLINE_COMPUTER_USE_HOST` | no | `127.0.0.1` | Backend host |
| `CLINE_COMPUTER_USE_DISPLAY_WIDTH` | no | queried from backend | Override display width, px |
| `CLINE_COMPUTER_USE_DISPLAY_HEIGHT` | no | queried from backend | Override display height, px |

## Not yet done

- No auth/handshake — this assumes the backend is a locally-spawned trusted
  process on loopback. Do not bind the backend to a non-loopback address.
- No reconnect/backoff policy in the client; a dropped connection fails all
  in-flight requests and reconnects lazily on the next call.
- No persisted setting/UI toggle; env-var opt-in only, matching this being a
  proof of concept.
- The Anthropic `anthropic-beta: computer-use-2025-11-24` header is sent
  unconditionally for the direct `anthropic` provider (see
  `sdk/packages/llms/src/providers/routing/anthropic-compatible.ts`) rather
  than gated on whether the `computer` tool is actually part of the current
  request. Fine for this proof of concept; revisit before shipping.
