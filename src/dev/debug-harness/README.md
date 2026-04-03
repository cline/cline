# Debug Harness

An HTTP-controlled debug server for the Cline VSCode extension. Provides
programmatic access to:

- **Extension host debugging** (Node.js): breakpoints, evaluate, step, pause/resume via CDP
- **Webview debugging** (Chrome): breakpoints, evaluate via CDP
- **UI automation**: click, type, screenshot, open sidebar via Playwright
- **Sourcemap resolution**: set breakpoints by original source file + line

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
```

## Full Build + Launch (first time)

```bash
# This builds protos, extension (unminified+sourcemaps), webview (unminified+sourcemaps),
# downloads VSCode, launches it, and connects CDP to the extension host.
npx tsx src/dev/debug-harness/server.ts --auto-launch
```

## API

All commands are sent as `POST /api` with JSON body `{"method": "...", "params": {...}}`.

Responses: `{"result": {...}}` on success, `{"error": "..."}` on failure.

Convenience endpoints:
- `GET /health` — `{"status": "ok"}`
- `GET /status` — Full harness status

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

Call `connect_webview` first after the sidebar is open.

| Method | Params | Description |
|--------|--------|-------------|
| `web.set_breakpoint` | `{url, line, column?, condition?}` | Set breakpoint by URL pattern |
| `web.remove_breakpoint` | `{breakpointId}` | Remove a breakpoint |
| `web.evaluate` | `{expression, callFrameId?}` | Evaluate in sidebar (Playwright) or at breakpoint (CDP) |
| `web.pause` | | Pause |
| `web.resume` | | Resume |
| `web.step_over/into/out` | | Stepping |

### UI Automation (Playwright)

| Method | Params | Description |
|--------|--------|-------------|
| `ui.screenshot` | `{fullPage?}` | Take screenshot → returns `{path}` |
| `ui.sidebar_screenshot` | | Screenshot focused on sidebar |
| `ui.click` | `{selector, frame?, delay?}` | Click element (`frame: "sidebar"` for webview) |
| `ui.fill` | `{selector, text, frame?}` | Fill input |
| `ui.press` | `{key}` | Press key (e.g., "Enter", "Meta+Shift+p") |
| `ui.type` | `{text, delay?}` | Type text |
| `ui.open_sidebar` | | Open the Cline sidebar |
| `ui.frames` | | List all frames |
| `ui.wait_for_selector` | `{selector, frame?, timeout?}` | Wait for element |
| `ui.command_palette` | `{command}` | Open command palette and run command |
| `ui.get_text` | `{selector, frame?}` | Get element text |
| `ui.locator` | `{role?, name?, testId?, text?, frame?, action?, value?}` | Rich Playwright locator |

### Combined

| Method | Params | Description |
|--------|--------|-------------|
| `wait_for_pause` | `{timeout?}` | Block until any debuggee hits a breakpoint |

## Example Workflows

### 1. Set a breakpoint and observe execution

```bash
# Set breakpoint in the extension's activate function
curl localhost:19229/api -d '{
  "method": "ext.set_breakpoint",
  "params": {"file": "src/extension.ts", "line": 25}
}'

# Trigger the breakpoint by opening the sidebar
curl localhost:19229/api -d '{"method": "ui.open_sidebar"}'

# Wait for the breakpoint to hit
curl localhost:19229/api -d '{"method": "wait_for_pause", "params": {"timeout": 10000}}'

# Examine the call stack
curl localhost:19229/api -d '{"method": "ext.call_stack"}'

# Evaluate a local variable
curl localhost:19229/api -d '{
  "method": "ext.evaluate",
  "params": {"expression": "context.extensionPath", "callFrameId": "<from call_stack>"}
}'

# Step over
curl localhost:19229/api -d '{"method": "ext.step_over"}'

# Continue
curl localhost:19229/api -d '{"method": "ext.resume"}'
```

### 2. Conditional breakpoint

```bash
curl localhost:19229/api -d '{
  "method": "ext.set_breakpoint",
  "params": {
    "file": "src/core/controller/index.ts",
    "line": 100,
    "condition": "message.type === \"newTask\""
  }
}'
```

### 3. Interact with the webview

```bash
# Open sidebar
curl localhost:19229/api -d '{"method": "ui.open_sidebar"}'

# Type in the chat input
curl localhost:19229/api -d '{
  "method": "ui.locator",
  "params": {"testId": "chat-input", "frame": "sidebar", "action": "fill", "value": "Hello!"}
}'

# Click send
curl localhost:19229/api -d '{
  "method": "ui.locator",
  "params": {"testId": "send-button", "frame": "sidebar", "action": "click"}
}'

# Take a screenshot
curl localhost:19229/api -d '{"method": "ui.screenshot"}'
# Returns: {"result": {"path": "/tmp/cline-debug/screenshot-0001.png"}}
```

### 4. Evaluate in the webview

```bash
curl localhost:19229/api -d '{
  "method": "web.evaluate",
  "params": {"expression": "document.title"}
}'
```

### 5. Find the right script for breakpoints

```bash
# List scripts containing "extension"
curl localhost:19229/api -d '{
  "method": "ext.scripts",
  "params": {"filter": "extension"}
}'

# List all original source files from the sourcemap
curl localhost:19229/api -d '{"method": "ext.source_files"}'
```

## How It Works

1. **Build**: esbuild bundles `src/extension.ts` → `dist/extension.js` (unminified, with
   sourcemaps). Vite builds `webview-ui/` → `webview-ui/build/` (unminified, inline sourcemaps).

2. **Launch**: Uses `@vscode/test-electron` to download VSCode, then Playwright's
   `_electron.launch()` to start it with `--inspect-extensions=9230` for Node.js inspector
   access and `--extensionDevelopmentPath` to load our extension.

3. **Extension CDP**: Connects to the extension host's V8 inspector via WebSocket on port 9230.
   Enables `Debugger` and `Runtime` domains. Tracks `scriptParsed` events and `paused`/`resumed`
   state.

4. **Sourcemap Resolution**: When setting breakpoints by source file, reads `dist/extension.js.map`
   and resolves the original file + line to the generated (bundled) file + line using VLQ-decoded
   sourcemap mappings.

5. **Webview CDP**: After the sidebar loads, creates a Playwright CDP session for the webview
   frame, enabling debugger commands. Falls back to `frame.evaluate()` for expression evaluation.

6. **UI Automation**: Playwright's Page/Frame APIs provide click, fill, type, screenshot, locator
   queries, and more. The sidebar webview is accessed as a Frame within the VSCode window.

## Troubleshooting

**"Inspector not available on port 9230"**: The extension host hasn't started yet. Wait longer
or check that the extension built correctly.

**"Sidebar frame not found"**: The Cline sidebar isn't open. Use `ui.open_sidebar` first.

**"Webview CDP not connected"**: Call `connect_webview` after the sidebar is open. If it fails,
webview breakpoints aren't available, but `web.evaluate` still works via Playwright.

**Sourcemap resolution fails**: Use `ext.source_files` to see what paths the sourcemap contains,
then use `ext.set_breakpoint_raw` with a `urlRegex` pattern.

**Screenshots directory**: Saved to `/tmp/cline-debug/` (configurable via SCREENSHOT_DIR).
