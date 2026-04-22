# Debug Harness

An HTTP-controlled debug server for the Cline VSCode extension. Provides
programmatic access to:

- **Extension host debugging** (Node.js): breakpoints, evaluate, step, pause/resume via CDP
- **Webview debugging** (Chrome): breakpoints, evaluate via CDP
- **UI automation**: click, type, screenshot, open sidebar via Playwright
- **Sourcemap resolution**: set breakpoints by original source file + line
- **Data isolation**: separate `~/.cline2` profile so debugee doesn't interfere with debugger
- **OAuth testing**: browser URL capture, token inspection, callback simulation

Designed to be driven from an agentic loop via `curl` commands.

## Quick Start

```bash
# Terminal 1: Start the debug harness server
npx tsx src/dev/debug-harness/server.ts --auto-launch --skip-build

# Terminal 2: Interact via curl
curl localhost:19229/api -d '{"method":"status"}'
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
curl localhost:19229/api -d '{"method":"ui.screenshot"}'
```

## Server Options

```
npx tsx src/dev/debug-harness/server.ts [options]

Options:
  --skip-build        Skip building extension/webview (use existing dist/)
  --auto-launch       Automatically launch VSCode on startup
  --workspace PATH    Workspace directory to open (default: /tmp/cline-debug-workspace)
  --port PORT         Server port (default: 19229)
  --cline-dir PATH    Override the debugee's CLINE_DIR (default: ~/.cline2)
```

## Full Build + Launch (first time)

```bash
# This builds protos, extension (unminified+sourcemaps), webview (unminified+sourcemaps),
# downloads VSCode, launches it, and connects CDP to the extension host.
npx tsx src/dev/debug-harness/server.ts --auto-launch
```

## Data Isolation

The debugee runs with `CLINE_DIR=~/.cline2` by default, keeping its data
separate from your real `~/.cline`. This prevents:

- Logging out of the debugger when the debugee logs out
- Task history, API keys, and settings leaking between instances
- State corruption from shared secrets.json

The isolated CLINE_DIR is reported in `status()` and `launch()` responses:

```bash
curl localhost:19229/api -d '{"method":"status"}'
# → { "clineDir": "/Users/you/.cline2", ... }
```

To use a different directory: `--cline-dir /tmp/test-cline-dir`

## Browser Capture & OAuth Testing

When the debug harness launches VSCode, it sets `CLINE_CAPTURE_BROWSER=1`
which intercepts all `openExternal()` calls in the debugee. Instead of
opening a real browser, URLs are:

1. **Logged to disk** at `$CLINE_DIR/data/debug-captured-urls.jsonl`
2. **POSTed in real-time** to the debug harness server at `/captured-url`
3. **Queryable** via the `oauth.captured_urls` API method

### OAuth API

| Method | Params | Description |
|--------|--------|-------------|
| `oauth.captured_urls` | `{clear?}` | Get URLs the debugee tried to open (captured by browser interception) |
| `oauth.read_stored_token` | | Read auth token presence from debugee's secrets.json |
| `oauth.simulate_callback` | `{path, code?, state?, provider?, token?}` | Build a vscode:// callback URI (for MCP/provider OAuth) |
| `oauth.read_captured_urls_file` | | Read the on-disk JSONL file of captured URLs |

### Testing Cline OAuth (login flow)

The Cline OAuth flow uses the SDK's local callback server. When the user
clicks "Login", the SDK:

1. Starts a local HTTP server on a random port
2. Calls `openExternal(authorizationUrl)` — which we capture
3. The user authenticates in the browser — which we need to simulate
4. The provider redirects to the local callback server with `?code=...`
5. The SDK captures the code and exchanges it for tokens

**To test this flow:**

```bash
# 1. Click "Login" in the debugee's sidebar
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
# Dismiss overlays first (see "Dismissing Promotional Overlays" below)
curl localhost:19229/api -d '{"method":"ui.locator","params":{"text":"Login to Cline","frame":"sidebar","action":"click"}}'

# 2. Check captured URLs to find the authorization URL
curl localhost:19229/api -d '{"method":"oauth.captured_urls"}'
# → { "urls": [{ "url": "https://api.cline.bot/auth/authorize?callback_url=http://127.0.0.1:PORT/..." }] }

# 3. The authorization URL has a callback_url pointing to the SDK's local server.
#    To complete the flow, you need to either:
#    a. Open the authorization URL in a real browser (it will redirect back
#       to the SDK's local callback server automatically)
#    b. Simulate the redirect by extracting the callback_url and making
#       a curl request to it with a code parameter:
curl "http://127.0.0.1:PORT/auth/callback?code=TEST_CODE" 2>/dev/null

# 4. Verify the token was stored
curl localhost:19229/api -d '{"method":"oauth.read_stored_token"}'
# → { "found": true, "hasAccountId": true, "keys": ["cline:clineAccountId"] }

# 5. Take a screenshot to verify the UI shows authenticated state
curl localhost:19229/api -d '{"method":"ui.screenshot"}'
```

### Testing MCP OAuth

MCP servers that require OAuth use a different flow: the browser redirects
to a `vscode://` URI handled by the extension's URI handler.

```bash
# 1. Trigger MCP OAuth (e.g., click "Authenticate" button for a server)
# 2. Check captured URLs for the authorization URL
curl localhost:19229/api -d '{"method":"oauth.captured_urls"}'

# 3. The MCP OAuth URL will have redirect_uri=vscode://saoudrizwan.claude-dev/mcp-auth/callback/HASH
#    Build the callback URI and inject it via ext.evaluate:
curl localhost:19229/api -d '{
  "method": "ext.evaluate",
  "params": {
    "expression": "require(\"./src/services/uri/SharedUriHandler\").SharedUriHandler.handleUri(\"vscode://saoudrizwan.claude-dev/mcp-auth/callback/HASH?code=TEST_CODE&state=SAVED_STATE\")"
  }
}'

# 4. Or use the convenience method:
curl localhost:19229/api -d '{
  "method": "oauth.simulate_callback",
  "params": {
    "path": "/mcp-auth/callback/HASH",
    "code": "TEST_CODE",
    "state": "SAVED_STATE"
  }
}'
```

### Testing Provider OAuth (OpenRouter, etc.)

```bash
# 1. Trigger provider login (e.g., "Get OpenRouter API Key" button)
# 2. Check captured URLs
curl localhost:19229/api -d '{"method":"oauth.captured_urls"}'
# 3. Simulate the redirect callback
curl localhost:19229/api -d '{
  "method": "oauth.simulate_callback",
  "params": {"path": "/openrouter", "code": "TEST_CODE"}
}'
```

## Practical Tips

### Dismissing Promotional Overlays

On fresh launches, one or more full-screen promo overlays may appear and
block all sidebar interactions. **Always dismiss them immediately after
opening the sidebar**, before any other interaction.

```bash
# Open sidebar first
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
# Dismiss ALL overlays (may need to run twice for multiple overlays)
curl localhost:19229/api -d '{"method":"web.evaluate","params":{"expression":"document.querySelectorAll(\".sr-only\").forEach(el => el.parentElement?.click())"}}'
```

### Navigating Between Views Using Commands

Instead of trying to find and click small icons in the sidebar header,
use VSCode commands via the command palette. These are registered in
`src/registry.ts`:

| Command | What it opens |
|---------|--------------|
| `cline.accountButtonClicked` | Account / sign-in view |
| `cline.historyButtonClicked` | Task history view |
| `cline.settingsButtonClicked` | Settings view |
| `cline.mcpButtonClicked` | MCP servers view |
| `cline.plusButtonClicked` | New task (chat view) |
| `cline.worktreesButtonClicked` | Worktrees view |

```bash
# Navigate to account view
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"cline.accountButtonClicked"}}'

# Navigate to history view
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"cline.historyButtonClicked"}}'

# Navigate to settings view
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"cline.settingsButtonClicked"}}'

# Navigate to MCP view
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"cline.mcpButtonClicked"}}'

# Start a new task (return to chat view)
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"cline.plusButtonClicked"}}'
```

### Typical Session Workflow

```bash
# 1. Launch (if not using --auto-launch)
curl localhost:19229/api -d '{"method":"launch","params":{"skipBuild":true}}'

# 2. Open sidebar and dismiss overlays
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
curl localhost:19229/api -d '{"method":"web.evaluate","params":{"expression":"document.querySelectorAll(\".sr-only\").forEach(el => el.parentElement?.click())"}}'

# 3. Check status (verify CLINE_DIR, browser capture, etc.)
curl localhost:19229/api -d '{"method":"status"}'

# 4. Navigate to the view you need
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"cline.accountButtonClicked"}}'

# 5. Interact and verify
curl localhost:19229/api -d '{"method":"ui.screenshot"}'

# 6. For OAuth flows, check captured URLs
curl localhost:19229/api -d '{"method":"oauth.captured_urls"}'

# 7. When done, shut down
curl localhost:19229/api -d '{"method":"shutdown"}'
```

## API

All commands are sent as `POST /api` with JSON body `{"method": "...", "params": {...}}`.

Responses: `{"result": {...}}` on success, `{"error": "..."}` on failure.

Convenience endpoints:
- `GET /health` — `{"status": "ok"}`
- `GET /status` — Full harness status
- `POST /captured-url` — Internal: receives captured browser URLs from debugee

### Lifecycle

| Method | Params | Description |
|--------|--------|-------------|
| `launch` | `{workspace?, skipBuild?}` | Build + launch VSCode |
| `shutdown` | | Close VSCode and CDP connections |
| `status` | | Current state of all components |
| `connect_webview` | | Connect CDP to the webview (call after sidebar is open) |

### Extension Host Debugging (Node.js)

| Method | Params | Description |
|--------|--------|-------------|
| `ext.set_breakpoint` | `{file, line, column?, condition?}` | Set breakpoint by source file (sourcemap-resolved) |
| `ext.set_breakpoint_raw` | `{url?, urlRegex?, scriptId?, lineNumber, columnNumber?, condition?}` | Set breakpoint with raw CDP params |
| `ext.remove_breakpoint` | `{breakpointId}` | Remove a breakpoint |
| `ext.evaluate` | `{expression, callFrameId?}` | Evaluate expression (at breakpoint or global) |
| `ext.pause` | | Pause execution |
| `ext.resume` | | Resume execution |
| `ext.step_over` | | Step over |
| `ext.step_into` | | Step into |
| `ext.step_out` | | Step out |
| `ext.call_stack` | | Get call stack (when paused) |
| `ext.scripts` | `{filter?}` | List loaded scripts |
| `ext.source_files` | | List source files from sourcemap |
| `ext.get_properties` | `{objectId}` | Get object properties |
| `ext.get_script_source` | `{scriptId}` | Get script source text |

### Webview Debugging (Chrome)

Call `connect_webview` first after the sidebar is open (only needed for breakpoints/stepping).

| Method | Params | Description |
|--------|--------|-------------|
| `web.set_breakpoint` | `{url, line, column?, condition?}` | Set breakpoint by URL pattern |
| `web.remove_breakpoint` | `{breakpointId}` | Remove a breakpoint |
| `web.evaluate` | `{expression, callFrameId?}` | Evaluate in sidebar (Playwright) or at breakpoint (CDP) |
| `web.post_message` | `{message}` | Send a postMessage to the extension host via exposed vsCodeApi |
| `web.pause` | | Pause |
| `web.resume` | | Resume |
| `web.step_over/into/out` | | Stepping |

### UI Automation (Playwright)

| Method | Params | Description |
|--------|--------|-------------|
| `ui.screenshot` | `{fullPage?}` | Take screenshot → returns `{path}` (use `read_file` on the path, don't `open` the file) |
| `ui.sidebar_screenshot` | | Screenshot focused on sidebar → returns `{path}` |
| `ui.click` | `{selector, frame?, delay?}` | Click element (`frame: "sidebar"` for webview) |
| `ui.fill` | `{selector, text, frame?}` | Fill input |
| `ui.press` | `{key}` | Press key (e.g., "Enter", "Meta+Shift+p") |
| `ui.type` | `{text, delay?}` | Type text |
| `ui.open_sidebar` | | Open the Cline sidebar |
| `ui.frames` | | List all frames |
| `ui.wait_for_selector` | `{selector, frame?, timeout?}` | Wait for element |
| `ui.command_palette` | `{command}` | Open command palette and run command |
| `ui.get_text` | `{selector, frame?}` | Get element text |
| `ui.locator` | `{role?, name?, testId?, text?, frame?, action?, value?}` | Rich Playwright locator (auto-retries with frame refresh for sidebar) |
| `ui.react_input` | `{text, selector?, clear?, submit?}` | Set React-controlled textarea value via `execCommand('insertText')` |
| `ui.send_message` | `{text, images?, files?, responseType?}` | Send a chat message bypassing the textarea (via gRPC postMessage) |

### OAuth & Browser Capture

| Method | Params | Description |
|--------|--------|-------------|
| `oauth.captured_urls` | `{clear?}` | Get URLs the debugee tried to open in a browser |
| `oauth.read_stored_token` | | Check auth token presence in debugee's secrets.json |
| `oauth.simulate_callback` | `{path, code?, state?, provider?, token?}` | Build a vscode:// callback URI for MCP/provider OAuth |
| `oauth.read_captured_urls_file` | | Read on-disk JSONL log of captured URLs |

### Combined

| Method | Params | Description |
|--------|--------|-------------|
| `wait_for_pause` | `{timeout?}` | Block until any debuggee hits a breakpoint |

## Example Workflows

### 1. Set a breakpoint and observe execution

```bash
curl localhost:19229/api -d '{
  "method": "ext.set_breakpoint",
  "params": {"file": "src/extension.ts", "line": 25}
}'
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
curl localhost:19229/api -d '{"method":"wait_for_pause","params":{"timeout":10000}}'
curl localhost:19229/api -d '{"method":"ext.call_stack"}'
curl localhost:19229/api -d '{"method":"ext.resume"}'
```

### 2. Test OAuth login flow

```bash
# Dismiss overlays, then click Login
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
curl localhost:19229/api -d '{"method":"web.evaluate","params":{"expression":"document.querySelectorAll(\".sr-only\").forEach(el => el.parentElement?.click())"}}'
curl localhost:19229/api -d '{"method":"ui.locator","params":{"text":"Login to Cline","frame":"sidebar","action":"click"}}'

# Check what URL was captured
curl localhost:19229/api -d '{"method":"oauth.captured_urls"}'

# The URL contains callback_url=http://127.0.0.1:PORT/...
# Open it in a real browser to complete auth, or simulate:
# (extract the port from the captured URL first)
curl "http://127.0.0.1:PORT/callback?code=real_or_test_code"

# Verify token stored
curl localhost:19229/api -d '{"method":"oauth.read_stored_token"}'
```

### 3. Navigate to Account view and check auth state

```bash
curl localhost:19229/api -d '{"method":"ui.command_palette","params":{"command":"cline.accountButtonClicked"}}'
curl localhost:19229/api -d '{"method":"ui.screenshot"}'
```

## How It Works

1. **Build**: esbuild bundles `src/extension.ts` → `dist/extension.js` (unminified, with
   sourcemaps). Vite builds `webview-ui/` → `webview-ui/build/` (unminified, inline sourcemaps).

2. **Launch**: Uses `@vscode/test-electron` to download VSCode, then Playwright's
   `_electron.launch()` to start it with `--inspect-extensions=9230` for Node.js inspector
   access and `--extensionDevelopmentPath` to load our extension.

3. **Data Isolation**: Sets `CLINE_DIR=~/.cline2` in the debugee's environment, ensuring
   the debugee uses a completely separate data directory from the user's real `~/.cline`.
   The `createStorageContext()` function in `src/shared/storage/storage-context.ts` reads
   this environment variable to determine where to store globalState.json, secrets.json,
   task history, and workspace state.

4. **Browser Capture**: Sets `CLINE_CAPTURE_BROWSER=1` and `CLINE_DEBUG_HARNESS_PORT=19229`
   in the debugee's environment. When `openExternal()` is called in `src/utils/env.ts`, it
   checks for `CLINE_CAPTURE_BROWSER` and, if set, logs the URL to a JSONL file and POSTs
   it to the debug harness server instead of opening a real browser. This is essential for
   testing OAuth flows without a visible browser.

5. **Extension CDP**: Connects to the extension host's V8 inspector via WebSocket on port 9230.
   Enables `Debugger` and `Runtime` domains. Tracks `scriptParsed` events and `paused`/`resumed`
   state.

6. **Sourcemap Resolution**: When setting breakpoints by source file, reads `dist/extension.js.map`
   and resolves the original file + line to the generated (bundled) file + line using VLQ-decoded
   sourcemap mappings.

7. **Webview CDP**: After the sidebar loads, creates a Playwright CDP session for the webview
   frame, enabling debugger commands. Falls back to `frame.evaluate()` for expression evaluation.

8. **UI Automation**: Playwright's Page/Frame APIs provide click, fill, type, screenshot, locator
   queries, and more. The sidebar webview is accessed as a Frame within the VSCode window.

## Caveats

**⚠️ Data Isolation**: The debugee uses `~/.cline2` by default. If you need to test with
existing data from your real `~/.cline`, copy it: `cp -r ~/.cline ~/.cline2`. Be aware that
secrets (API keys, auth tokens) will be shared if you do this.

**⚠️ "Introducing Cline Kanban" overlay**: On fresh launches, a full-screen promo overlay may
appear in the sidebar. It blocks all interactions and makes screenshots useless. **Dismiss it
immediately after opening the sidebar**, before doing anything else:
```bash
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
curl localhost:19229/api -d '{"method":"web.evaluate","params":{"expression":"document.querySelectorAll(\".sr-only\").forEach(el => el.parentElement?.click())"}}'
```

**Screenshots**: `ui.screenshot` and `ui.sidebar_screenshot` save PNG files to `/tmp/cline-debug/`
and return `{path}` in the response. **Do NOT `open` the file** — on macOS this launches Preview.app
which covers the VSCode window. Use `read_file` on the returned path to examine the image.

**OAuth with real providers**: The browser capture only intercepts the URL that the debugee tries
to open. For Cline OAuth, the SDK's local callback server is still running and will accept
redirects. For provider OAuth (OpenRouter, MCP), you need to simulate the `vscode://` callback
URI — see the OAuth testing section above.

**Cline OAuth with invalid codes**: If you simulate the OAuth callback with a fake code, the
SDK's token exchange will fail (the provider won't recognize the code). You need either a real
authorization code (obtained by completing the flow in a browser) or a way to mock the token
exchange endpoint.

## Troubleshooting

**"Inspector not available on port 9230"**: The extension host hasn't started yet. Wait longer
or check that the extension built correctly.

**"Sidebar frame not found"**: The Cline sidebar isn't open. Use `ui.open_sidebar` first.

**"Webview CDP not connected"**: Call `connect_webview` after the sidebar is open. If it fails,
webview breakpoints aren't available, but `web.evaluate` still works via Playwright.

**Sourcemap resolution fails**: Use `ext.source_files` to see what paths the sourcemap contains,
then use `ext.set_breakpoint_raw` with a `urlRegex` pattern.

**Screenshots directory**: Saved to `/tmp/cline-debug/` (configurable via SCREENSHOT_DIR).

**Debugee still uses ~/.cline**: Check that `CLINE_DIR` appears in the `status()` response.
If it's missing, the debugee may have been launched before the harness set the env var.
Shutdown and relaunch.