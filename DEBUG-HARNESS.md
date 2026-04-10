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

- **"Introducing Cline Kanban" promotion**: On fresh launches, a
  full-screen promotional overlay ("Introducing Cline Kanban") may
  appear in the sidebar webview. It obscures all other UI elements, so
  screenshots will show only the promo and interactions with the chat
  input, settings buttons, etc. will fail. You must dismiss it before
  doing anything else. Use the debug harness to click the dismiss/close
  button:
  ```bash
  curl localhost:19229/api -d '{
    "method": "ui.locator",
    "params": {"text": "Dismiss", "frame": "sidebar", "action": "click"}
  }'
  ```
  Or close it via `web.evaluate`:
  ```bash
  curl localhost:19229/api -d '{
    "method": "web.evaluate",
    "params": {"expression": "document.querySelector('[data-testid=\"dismiss-announcement\"]')?.click() || document.querySelector(\"button\")?.click()"}
  }'
  ```
  If the exact selector changes, take a screenshot first
  (`ui.sidebar_screenshot`) to identify the current dismiss control.

- **CDP disconnects after window reload**: If you use
  `workbench.action.reloadWindow` (e.g., to pick up a rebuilt
  webview), the extension host CDP connection drops. You must do a full
  `shutdown` + relaunch of the debug harness to reconnect.

## References

You can see the vscode source code in ~/clients/cline/vscode and
search it with kb_search vscode

You can search the cline source code (snapshot) with kb_search cline.