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
- **`ui.locator`** `{role?, testId?, text?, action?, frame?}` — Playwright locator (auto-retries on stale sidebar frame)
- **`ui.react_input`** `{text, selector?, clear?, submit?}` — set React textarea value via `execCommand('insertText')`; works reliably across multiple tasks
- **`ui.send_message`** `{text, images?, files?, responseType?}` — send chat message bypassing the textarea entirely (via gRPC postMessage)
- **`ui.command_palette`** `{command}` — run VSCode command

## Caveats

- **⚠️ Dismiss "Introducing Cline Kanban" overlay FIRST**: On fresh launches a full-screen promo overlay blocks the sidebar. **Dismiss it immediately after `ui.open_sidebar`**, before any other interaction or screenshot. Most reliable method:
  ```bash
  curl localhost:19229/api -d '{"method": "ui.open_sidebar"}'
  curl localhost:19229/api -d '{"method": "web.evaluate", "params": {"expression": "document.querySelector(\".sr-only\")?.parentElement?.click()"}}'
  ```
- **Screenshots — don't open the file**: `ui.screenshot` and `ui.sidebar_screenshot` save PNGs to `/tmp/cline-debug/` and return the `{path}`. Use `read_file` on the path to examine screenshots. Running `open <path>` launches Preview.app on macOS which covers the VSCode window.
- **Scripts count = 0 after launch**: CDP connects after extension host starts, so scripts parsed during startup aren't tracked. Breakpoints still work via sourcemap resolution.
- **Port 9230**: Extension host inspector. If another VSCode instance uses this port, the harness will fail to connect. Kill other debug instances first.
- **macOS only** for now (Playwright Electron launch behavior).
- **Webview CDP**: `connect_webview` may fail depending on Electron version. `web.evaluate` still works via Playwright's `frame.evaluate()` fallback.
- **Sourcemap paths**: esbuild outputs relative paths like `../src/extension.ts` in the sourcemap. The resolver handles this, but if a file isn't found, use `ext.source_files` to see exact paths.

See `src/dev/debug-harness/README.md` for full API reference.
