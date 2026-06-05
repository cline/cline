# Debug Harness

HTTP-controlled debugger for the VSCode extension at `src/dev/debug-harness/server.ts`.

## Quick start

```bash
# Build extension first if needed (protos + esbuild):
npm run protos && IS_DEV=true node esbuild.mjs

# Launch (skip-build if already built):
npx tsx src/dev/debug-harness/server.ts --skip-build --auto-launch

# In another terminal:
curl localhost:19229/api -d '{"method":"status"}'
```

## Running inside a Maestro container (computer-use demo)

The debug harness is the bridge that lets a **host** Cline agent drive a VS Code
extension build that runs **inside a Maestro Docker session**. The host agent
uses the `createMaestroTools` tools (`@cline/core`) — `maestro_exec` to run
shell commands in the session's container, and `maestro_screenshot` /
`maestro_click` / `maestro_type` / `maestro_key` to interact with the GUI.

Architecture:

```
host Cline agent ── maestro tools (HTTP) ──▶ maestro-daemon ──▶ container
                                                                 ├─ VS Code (Xvfb display :N)
                                                                 └─ debug-harness server :19229
host agent ──────── maestro_exec curl ─────────────────────────▶ harness /api
```

Two ways the host reaches the harness:

1. **Via `maestro_exec` (no published port needed).** Run `curl` against
   `localhost:19229` *inside* the container, since the harness and the exec
   command share the container's network namespace. This is the simplest path
   and is what the demo uses.
2. **Via a published port.** If you start the container with `-p 19229:19229`
   (or the daemon publishes it), the host can hit the harness directly. Only one
   session per container can own 19229.

### One-time setup (host)

```bash
# Mount the worktree under repair into ONE container and start the daemon:
cargo run --bin maestro-daemon -- \
  --image maestro:arm64-base \
  --mount /Users/you/clients/cline/cline2:/workspace/cline
```

Then the host agent, through the maestro tools:

```jsonc
// Attach a session to that mounted container (NOT a fresh one):
maestro_create_session { "label": "cline debug", "container_id": "<container>" }
// → { session_id }
```

> ⚠️ Get the mount right or `/workspace/cline` won't exist:
> - Pass **`container_id`** to land the session on an already-running, already-mounted container.
> - Or pass **`mounts`** to have the daemon start a *fresh* container with that
>   bind mount, e.g.
>   `maestro_create_session { "mounts": ["/Users/you/clients/cline/cline2:/workspace/cline"] }`.
>   This is how one daemon serves multiple workspaces — each new container mounts
>   a different host checkout.
> - With neither, the daemon falls back to its global `--mount` args (which may be
>   none, giving a container with no mounts).

### Build + launch the harness in the session (via `maestro_exec`)

```jsonc
// 1. Build the extension against the mounted checkout:
maestro_exec {
  "session_id": "<id>",
  "cwd": "/workspace/cline/apps/vscode",
  "cmd": "npm run protos && IS_DEV=true node esbuild.mjs"
}

// 2. Launch the harness detached so it keeps running (DISPLAY is set to the
//    session, so the VS Code window appears in this session's desktop):
maestro_exec {
  "session_id": "<id>",
  "cwd": "/workspace/cline/apps/vscode",
  "cmd": "npx tsx src/dev/debug-harness/server.ts --skip-build --auto-launch",
  "background": true
}

// 3. Drive the harness from inside the container:
maestro_exec {
  "session_id": "<id>",
  "cmd": "curl -s localhost:19229/api -d '{\"method\":\"status\"}'"
}
```

From here the host agent can `ui.screenshot` via the harness **or** use
`maestro_screenshot` to watch the whole desktop — and a human can observe/take
over live in `maestro-ui`. Set breakpoints, evaluate, step, etc. exactly as
below; just wrap each `curl localhost:19229/api ...` in a `maestro_exec` call.

> Tip: keep the harness output for debugging — `maestro_exec background:true`
> redirects it to `/tmp/maestro-exec-<uuid>.log` inside the container; `cat` it
> via another `maestro_exec` if the harness seems unhealthy.

## Data Isolation

The debugee runs with `CLINE_DIR=~/.cline2` by default, separate from your real `~/.cline`.
This prevents the debugee's logout from logging out the debugger, and vice versa.
Override with `--cline-dir /tmp/test-dir`. Check with `status()` → `clineDir`.

## Browser Capture & OAuth

The debugee runs with `CLINE_CAPTURE_BROWSER=1`, which intercepts `openExternal()` in
`src/utils/env.ts`. URLs are captured instead of opening a real browser:

- Logged to `$CLINE_DIR/data/debug-captured-urls.jsonl`
- POSTed in real-time to `/captured-url` on the harness server
- Queryable via `oauth.captured_urls`

### OAuth API

- **`oauth.captured_urls`** `{clear?}` — URLs the debugee tried to open
- **`oauth.read_stored_token`** — Check auth token presence in secrets.json
- **`oauth.simulate_callback`** `{path, code?, state?, provider?, token?}` — Build vscode:// callback URI
- **`oauth.read_captured_urls_file`** — Read on-disk JSONL of captured URLs

### OAuth testing flow

For **Cline OAuth** (SDK local callback): The SDK starts a local HTTP server, the auth URL
is captured. To complete: open the captured URL in a real browser (it redirects back to the
SDK's callback server), OR extract the callback port and `curl http://127.0.0.1:PORT/callback?code=...`.

For **MCP/Provider OAuth** (vscode:// URI): The redirect goes to a vscode:// URI.
`oauth.simulate_callback` only *builds* the URI — it does not deliver it, and the ESM
extension host can't `require()` the handler. To actually deliver the callback, call the
debug-only hook via `ext.evaluate` (with `awaitPromise: true`):
`globalThis.__clineHandleUri("vscode://saoudrizwan.claude-dev/...?code=...&state=...")`.
It runs the same `SharedUriHandler.handleUri` as VSCode's real URI handler and exists only
when `CLINE_CAPTURE_BROWSER` is set (the harness always sets it; never ships in prod).
For end-to-end MCP OAuth, get a real `code` from the local MCP OAuth test server
(`npm run dev:mcp-oauth-test-server`).

## Navigating Views — Use Commands, Not Clicks

Don't try to find/click small sidebar icons. Use VSCode commands via command palette.
Registered in `src/registry.ts`:

| Command | View |
|---------|------|
| `cline.accountButtonClicked` | Account / sign-in |
| `cline.historyButtonClicked` | Task history |
| `cline.settingsButtonClicked` | Settings |
| `cline.mcpButtonClicked` | MCP servers |
| `cline.plusButtonClicked` | New task (chat) |
| `cline.worktreesButtonClicked` | Worktrees |

```bash
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"cline.accountButtonClicked"}}'
```

## Key commands

All via `POST localhost:19229/api` with `{"method":"...", "params":{...}}`:

- **`launch`** / **`shutdown`** — lifecycle
- **`ui.screenshot`** — screenshot to `/tmp/cline-debug/`; returns `{path}` — **use `read_file` on the path to examine, do NOT `open` the file** (Preview.app covers the VSCode window)
- **`ui.open_sidebar`** — open the Cline sidebar
- **`ext.set_breakpoint`** `{file, line, condition?}` — breakpoint by source file (sourcemap-resolved)
- **`ext.evaluate`** `{expression, callFrameId?}` — eval in extension host
- **`ext.resume`** / **`ext.step_over`** / **`ext.step_into`** — stepping
- **`ext.call_stack`** — inspect when paused
- **`web.evaluate`** `{expression}` — eval in webview
- **`web.post_message`** `{message}` — send postMessage to extension host via exposed vsCodeApi
- **`wait_for_pause`** `{timeout?}` — block until breakpoint hit
- **`ui.locator`** `{role?, testId?, text?, frame?}` — Playwright locator (auto-retries on stale sidebar frame)
- **`ui.react_input`** `{text, selector?, clear?, submit?}` — set React textarea value via `execCommand('insertText')`; works reliably across multiple tasks
- **`ui.send_message`** `{text, images?, files?, responseType?}` — send chat message bypassing the textarea entirely (via gRPC postMessage)
- **`ui.command_palette`** `{command}` — run VSCode command

## Typical Session

```bash
# 1. Launch
curl localhost:19229/api -d '{"method":"launch","params":{"skipBuild":true}}'

# 2. Open sidebar + dismiss overlays (ALWAYS do this first)
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
curl localhost:19229/api -d '{"method":"web.evaluate","params":{"expression":"document.querySelectorAll(\".sr-only\").forEach(el => el.parentElement?.click())"}}'

# 3. Navigate to view
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"cline.accountButtonClicked"}}'

# 4. Check captured OAuth URLs if testing auth
curl localhost:19229/api -d '{"method":"oauth.captured_urls"}'

# 5. Verify
curl localhost:19229/api -d '{"method":"ui.screenshot"}'
```

## Caveats

- **⚠️ Dismiss promotional overlays FIRST**: On fresh launches, full-screen promo overlays block the sidebar. **Dismiss immediately after `ui.open_sidebar`**, before any other interaction or screenshot. May need to run twice:
  ```bash
  curl localhost:19229/api -d '{"method": "ui.open_sidebar"}'
  curl localhost:19229/api -d '{"method": "web.evaluate", "params": {"expression": "document.querySelectorAll(\".sr-only\").forEach(el => el.parentElement?.click())"}}'
  ```
- **Screenshots — don't open the file**: `ui.screenshot` and `ui.sidebar_screenshot` save PNGs to `/tmp/cline-debug/` and return the `{path}`. Use `read_file` on that path to examine screenshots. Running `open <path>` launches Preview.app on macOS which covers the VSCode window.
- **Scripts count = 0 after launch**: CDP connects after extension host starts, so scripts parsed during startup aren't tracked. Breakpoints still work via sourcemap resolution.
- **Port 9230**: Extension host inspector. If another VSCode instance uses this port, the harness will fail to connect. Kill other debug instances first.
- **macOS only** for now (Playwright Electron launch behavior).
- **Webview CDP**: `connect_webview` may fail depending on Electron version. `web.evaluate` still works via Playwright's `frame.evaluate()` fallback.
- **Sourcemap paths**: esbuild outputs relative paths like `../src/extension.ts` in the sourcemap. The resolver handles this, but if a file isn't found, use `ext.source_files` to see exact paths.
- **OAuth with fake codes**: Browser capture intercepts the URL but doesn't provide a valid auth code. For real OAuth testing, open the captured URL in a browser. For unit testing, mock the token exchange.

See `src/dev/debug-harness/README.md` for full API reference.
