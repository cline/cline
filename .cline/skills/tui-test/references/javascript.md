# JavaScript

Use `@microsoft/tui-test` from JavaScript or TypeScript.

[Back to the skill](../SKILL.md)

## Start

```sh
bun add -d @microsoft/tui-test
```

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

```js
const locator = terminal
  .getByText("Settings")
  .getByText("Save", { direction: "after" })
  .unique();
```

| Method | Use |
| --- | --- |
| `getByText(text, options?)` | Match text or regex. |
| `getByStyle(style, options?)` | Match appearance; when chained, require it on the whole match. |
| `getByLink(uri, options?)` | Match an OSC 8 target; when chained, require it on every cell. `""` means unlinked. |
| `and(other)`, `or(other)` | Intersect/union cells, then form contiguous per-row runs. |
| `filter({ has?, hasNot? })` | Keep whole matches containing an inner match or containing none. |
| `any()` | Keep all matches. |
| `unique()` | Require one match. |
| `first()`, `last()`, `nth(index)` | Select a match. |
| `locations()`, `location()`, `count()`, `all()` | Read matches. |
| `wait({ state?, timeout? })` | Wait for visible or hidden. |
| `expect({ not?, timeout? })` | Assert. |
| `click(options?)` | Click. |
| `highlight({ timeout? })` | Highlight. |

Text options: `regex`, `full`, `whitespace`, and chained `direction`.

Style/link options are `full` and chained `direction`. Filter accepts locators
only; use `getByText()` for text containment. A partially linked text match
passes `filter({ has: terminal.getByLink(uri) })` but fails chained
`getByLink(uri)`. `.and(terminal.getByLink(uri))` returns its linked cells.
Appearance refinement skips blanks when the match has visible characters;
link refinement checks blanks too.

Composition requires operands from the same terminal instance. It is lazy,
uses one snapshot, and merges adjacent selected cells even from different
matches. Separate rows remain separate runs; composed text uses exact-grid
whitespace. Apply `first()`/`nth()` after composition to select final runs.
Any `full` branch makes the entire query use the full grid.

Click options: `button`, `alt`, `ctrl`, `shift`, `clicks`, and `timeout`.

## Session

| Method | Use |
| --- | --- |
| `open(options?)` | Open a shell. |
| `run(program, args?, options?)` | Run an app. |
| `restart(options?)` | Restart the session. |
| `submit(text?)` | Type and press Enter. |
| `type(text)`, `write(data)` | Send text or bytes. |
| `resize(cols, rows)` | Resize. |
| `signal(name)`, `kill()` | Stop the child. |
| `state()`, `text()`, `cells()` | Read terminal state. |
| `getCommand()`, `getOutput()`, `getExitCode()` | Read command state. |
| `getCwd()`, `getCursor()`, `getSize()`, `getTitle()` | Read terminal fields. |
| `getClipboard()` | Read the session clipboard. |
| `getBellCount()`, `getBellEvents()` | Read bells. |
| `waitCommand()`, `waitExit()`, `waitReady()`, `waitIdle()` | Wait for state. |
| `waitTitle()`, `waitClipboard()`, `waitBell()` | Wait for events. |
| `expectTitle()`, `expectOutput()`, `expectExitCode()` | Assert state. |
| `expectBellCount()`, `expectSnapshot()` | Assert bells or snapshots. |
| `screenshot()` | Read text or save SVG or PNG. |
| `startRecording()`, `stopRecording()` | Record. |
| `close()`, `closeQuiet()` | Close. |

Capture options: `background` and `transparent` (SVG, APNG, and GIF).

`restart({ gracefulTimeout: 5000 })` returns an `OpenResult`, preserving the last successful spawn's original working directory, options, and latest terminal size. The timeout is milliseconds after Ctrl-C before forced replacement; `0` skips the wait. Child exit preserves restart metadata; `close()` clears it. The terminal and automatic recording start fresh.

Constructor options: `backend`, `timeouts`, `profile`, `artifacts`, `recording`, `trace`, and `screenHistoryLimit`.

Use `trace: { mode: "on" | "off" | "on-failure", directory: "traces" }`.
Traces default to `off`. Users can open `trace.html` or replay `session.cast`; agents should read `trace.md`, `trace.json`, and `timeline.json`.

Failure artifact modes are `none`, `text`, `html`, and `all`. Use `includeRecording: true` to include the cast.

## Input helpers

```js
await terminal.keyboard.press("Ctrl+C");
await terminal.mouse.click(10, 5, { button: "right", ctrl: true });
```

Keyboard: `press`, `down`, `repeat`, and `up`.

Named keys include arrows, Home, End, PageUp, PageDown, Insert, Delete, Backspace, Tab, Enter, Space, Escape, and F1 through F12. Join modifiers with `+`.

Mouse: `click`, `move`, `down`, `up`, `drag`, and `scroll`.

## Test helpers

```js
import { withTerminal } from "@microsoft/tui-test/test";

await withTerminal({ program: ["my-app"] }, async (app) => {
  await app.getByText("Ready").expect();
});
```

Helpers: `createTerminal`, `withTerminal`, `closeAllTracked`, `setTerminalDefaults`, `resetTerminalDefaults`, and `terminalSnapshot`.

## Errors

`ExpectationError`, `UsageError`, `NoSessionError`, and `InternalError` extend `TuiTestError`.

Full API: [bindings/js/README.md](https://github.com/microsoft/tui-test/blob/main/bindings/js/README.md)
