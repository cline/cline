# E2E Debugging Visibility

This is a sub-project of the project described in migration.md. We are
engaging in a big change to the VSCode extension. You gain visibility
into the extension through tests, but sometimes that is not enough.

Your goal is to create way where you can launch the VSCode extension
and have access to the node debugger and webview debugger so that you
can set break points, evaluate expressions, inject input (consider
Microsoft's work with Playwright in VSCode, but anything that works is
fine) step, etc. so that you can observe execution and find and fix
problems without the tedious cycle off adding print statements,
running a test which may hang, fixing something, removing the print
statements, etc.

For this step to be complete, you need to demonstrate you have the
ability to:

1. Build and run the VSCode extension in an unminified form, including
   the webview unminified.

2. Add and remove breakpoints, including conditional breakpoints, on
   the extension side.

3. Add and remove breakpoints, including conditional breakpoints, on
   the webview side.

4. Evaluate expressions at breakpoints. You should be able to refer to
   local variables, that is, the extension code should be
   unminified. (Concatenated is fine as long as you can find your way
   around.)

5. Run, step at breakpoints.

6. Generate UI actions like opening the Cline sidebar, focusing
   elements, typing, etc.

7. Take screenshots that you can view.

You need to use this tool inside your agentic loop, that is, you will
need to drive both of these debugees simultaneously from one loop, so
you may need to write yourself a tool which blocks until one of the
debugees hits a breakpoint; can use a timeout and let you break and
examine isolates and stacks; things of that nature.

We are working on macOS, it is fine if this tool just works on macOS
for now.

## Caveats

- **`CLINE_DIR` environment variable**: Because the debug harness
  spawns a fresh VSCode instance that runs the Cline extension, and
  because *you* (the agent) share state with that extension (API keys,
  provider settings, task history), you **must** set `CLINE_DIR=~/.cline`
  when launching the harness. Without it the debugee uses an isolated
  data directory and won't have your API keys or provider configuration,
  causing inference to fail silently (requests hang or error).
  ```bash
  CLINE_DIR=~/.cline npx tsx src/dev/debug-harness/server.ts --skip-build --auto-launch
  ```

- **⚠️ "Introducing Cline Kanban" promotion — DISMISS FIRST**: On
  fresh launches, a full-screen promotional overlay ("Introducing Cline
  Kanban") may appear in the sidebar webview. It obscures all other UI
  elements, so screenshots will show only the promo and interactions
  with the chat input, settings buttons, etc. will fail. **You must
  dismiss it immediately after opening the sidebar, before doing
  anything else.** This is easy to forget — if your screenshots look
  wrong or interactions fail, this is almost certainly why.

  **Method 1 — Click the close button via DOM** (most reliable):
  ```bash
  curl localhost:19229/api -d '{"method": "ui.open_sidebar"}'
  curl localhost:19229/api -d '{
    "method": "web.evaluate",
    "params": {"expression": "document.querySelector(\".sr-only\")?.parentElement?.click()"}
  }'
  ```
  This finds the `<span class="sr-only">Close</span>` element and
  clicks its parent `<button>`.

  **Method 2 — Press ESC** (simpler but less reliable):
  ```bash
  curl localhost:19229/api -d '{"method": "ui.open_sidebar"}'
  curl localhost:19229/api -d '{
    "method": "web.evaluate",
    "params": {"expression": "document.activeElement.dispatchEvent(new KeyboardEvent(\"keydown\", {key: \"Escape\", code: \"Escape\", keyCode: 27, bubbles: true}))"}
  }'
  ```

  If neither works, take a screenshot (`ui.screenshot`) to see what's
  on screen and identify the current dismiss control.

- **Screenshots**: `ui.screenshot` and `ui.sidebar_screenshot` save
  PNG files to `/tmp/cline-debug/` and return `{path}` in the JSON
  response. **Do NOT open the screenshot file with `open`** — on macOS
  this launches Preview.app which covers the VSCode window you're
  debugging. Use `read_file` on the returned path to examine the image
  without disrupting the debuggee.

- **Debuggee launch delay**: The post-launch activation delay is 1
  second. If the extension hasn't fully loaded by the time you interact
  with it, just retry — `ui.open_sidebar` and `findSidebar` have their
  own internal polling with timeouts.

- **Top toolbar buttons**: The "new task", "mcp servers", "history",
  "accounts", and "settings" toolbar buttons are not in the webview DOM
  (they're VSCode UI chrome). Instead of trying to click them, run the
  associated VSCode commands directly:
  - New Task: `cline.plusButtonClicked`
  - MCP Servers: `cline.showMcpServers`
  - History: `cline.showHistory`
  - Accounts: `cline.showAccount`
  - Settings: `cline.openSettings`
  
  Example:
  ```bash
  curl localhost:19229/api -d '{
    "method": "ui.command_palette",
    "params": {"command": "cline.openSettings"}
  }'
  ```

- **CDP disconnects after window reload**: If you use
  `workbench.action.reloadWindow` (e.g., to pick up a rebuilt
  webview), the extension host CDP connection drops. You must do a full
  `shutdown` + relaunch of the debug harness to reconnect.

## References

You can see the vscode source code in ~/clients/cline/vscode and
search it with kb_search vscode

You can search the cline source code (snapshot) with kb_search cline.