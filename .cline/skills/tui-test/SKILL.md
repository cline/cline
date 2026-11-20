---
name: tui-test
description: "Control, inspect, test, and record real terminal apps with the tui-test CLI or its Rust, Python, and JavaScript APIs. Use for shells, TUI apps, text and style locators, keyboard or mouse input, terminal state, clipboard waits, screenshots, recordings, snapshots, and live terminal sessions."
---

# tui-test

Use `tui-test` to control and test a real terminal.

## Pick an API

| Context | Use | Reference |
| --- | --- | --- |
| Agent or shell workflow | CLI | [CLI](references/cli.md) |
| Python code | `tui_test` | [Python](references/python.md) |
| JavaScript or TypeScript | `@microsoft/tui-test` | [JavaScript](references/javascript.md) |
| Rust code | `tui-test-rs` | [Rust](references/rust.md) |
| Common tasks | Current project language | [Recipes](references/recipes.md) |

Use the library that matches the project. Use the CLI when the terminal must persist across separate commands or be watched with `monitor`.

CLI and library sessions do not share state.

## CLI

```sh
tui-test run my-app
tui-test expect text "Ready"
tui-test click text "Continue"
tui-test expect text "Done"
tui-test close
```

Run `tui-test agent-context` for exact command and option names.

## Python

```python
from tui_test import TuiTest

async with TuiTest.ephemeral() as terminal:
    await terminal.run("my-app")
    await terminal.get_by_text("Ready").expect()
    await terminal.get_by_text("Continue").click()
```

## JavaScript

```js
import { TuiTest } from "@microsoft/tui-test";

const terminal = TuiTest.ephemeral();
try {
  await terminal.run("my-app");
  await terminal.getByText("Ready").expect();
  await terminal.getByText("Continue").click();
} finally {
  await terminal.closeQuiet();
}
```

## Locators

Use text and style locators for visible terminal state.

```python
save = (
    terminal
    .get_by_text("Settings")
    .get_by_text("Save", direction="after")
    .unique()
)

await save.click()
```

- Use `first()`, `last()`, `nth()`, or `unique()` before an action when text repeats.
- Use `get_by_style()` or `getByStyle()` for colors and attributes.
- Use `direction="within"`, `"after"`, or `"before"` for relative matches.
- Use `locations()` or `count()` for immediate reads.
- Use `wait()`, `expect()`, or `click()` when the app may still be changing.

## Wait for state

| Need | Use |
| --- | --- |
| Visible or hidden text | Locator `wait()` or `expect()` |
| Submitted command finished | `wait command`, `wait_command()`, `waitCommand()` |
| Program exited | `wait exit`, `wait_exit()`, `waitExit()` |
| Shell prompt ready | `wait ready`, `wait_ready()`, `waitReady()` |
| Screen stopped changing | `wait idle`, `wait_idle()`, `waitIdle()` |
| Clipboard changed or matched | `wait clipboard`, `wait_clipboard()`, `waitClipboard()` |
| Bell fired | `wait bell`, `wait_bell()`, `waitBell()` |

Do not use a fixed sleep when a wait can describe the state.

## Keep tests stable

- Give parallel tests unique sessions.
- Use `open` for shell commands and `run` for an app.
- Assert the exit code separately from visible text.
- Keep the shell, terminal size, cwd, environment, and timeouts explicit when they affect output.
- Use semantic mouse buttons: `left`, `middle`, or `right`.
- Close every session. Prefer the Python and JavaScript test helpers.

## Capture output

Use `screenshot` for text, SVG, or PNG. SVG, PNG, APNG, and GIF support `--background COLOR` and `--transparent`. MP4 supports `--background` only. Use `record` for APNG, GIF, MP4, or asciinema. Configure `[trace]` with `mode = "on-failure"` and a `directory` for test artifacts, including agent-readable Markdown/JSON, an asciicast, and standalone HTML. Trace modes are `off` (default), `on`, and `on-failure`; `[recording]` only accepts `directory`.

For a failed assertion that must be understood offline, add `--failure-artifacts <dir>`. Agents should read `failure.md` first, then `failure.json` for exact locator/process evidence and `timeline.json` for retained per-cell frame metadata. Users can open `failure.html` directly from disk to navigate assertion checkpoints, step frames, and inspect clicked cells. Missing history is explicit; sampled frames are not a complete recording. Add `--failure-artifact-recording` for a continuous cast only when terminal output is safe to retain; diagnostic bundles can contain sensitive terminal text, titles, and locator operands.

## References

- [CLI](references/cli.md)
- [Python](references/python.md)
- [JavaScript](references/javascript.md)
- [Rust](references/rust.md)
- [Recipes](references/recipes.md)
