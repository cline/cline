# Python

Use `tui_test` from Python code and tests.

[Back to the skill](../SKILL.md)

## Start

```sh
pip install tui-test
```

```python
from tui_test import TuiTest

async with TuiTest.ephemeral() as terminal:
    await terminal.run("my-app")
    await terminal.get_by_text("Ready").expect()
    await terminal.get_by_text("Continue").click()
```

## Locators

```python
locator = (
    terminal
    .get_by_text("Settings")
    .get_by_text("Save", direction="after")
    .unique()
)
```

| Method | Use |
| --- | --- |
| `get_by_text(text, **options)` | Match text or regex. |
| `get_by_style(style, **options)` | Match appearance; when chained, require it on the whole match. |
| `get_by_link(uri, **options)` | Match an OSC 8 target; when chained, require it on every cell. `""` means unlinked. |
| `and_(other)`, `or_(other)` | Intersect/union cells, then form contiguous per-row runs. |
| `filter(has=..., has_not=...)` | Keep whole matches containing an inner match or containing none. |
| `any()` | Keep all matches. |
| `unique()` | Require one match. |
| `first()`, `last()`, `nth(index)` | Select a match. |
| `locations()`, `location()`, `count()`, `all()` | Read matches. |
| `wait(state="visible", timeout=None)` | Wait for visible or hidden. |
| `expect(not_=False, timeout=None)` | Assert. |
| `click(**options)` | Click. |
| `highlight(timeout=None)` | Highlight. |

Text options: `regex`, `full`, `whitespace`, and chained `direction`.

Style/link options are `full` and chained `direction`. Filter accepts locators
only; use `get_by_text()` for text containment. A partially linked text match
passes `filter(has=terminal.get_by_link(uri))` but fails chained
`get_by_link(uri)`. `and_(terminal.get_by_link(uri))` returns its linked cells.
Appearance refinement skips blanks when visible characters are present;
link refinement checks blanks too.

Composition requires operands from the same terminal instance. It is lazy,
uses one snapshot, and merges adjacent selected cells even from different
matches. Separate rows remain separate runs; composed text uses exact-grid
whitespace. Any `full` branch makes the whole query use the full grid.

Click options: `button`, `alt`, `ctrl`, `shift`, `clicks`, and `timeout`.

## Session

| Method | Use |
| --- | --- |
| `open(**options)` | Open a shell. |
| `run(program, *args, **options)` | Run an app. |
| `restart(graceful_timeout=5000)` | Restart the session. |
| `submit(text=None)` | Type and press Enter. |
| `type(text)`, `write(data)` | Send text or bytes. |
| `resize(cols, rows)` | Resize. |
| `signal(name)`, `kill()` | Stop the child. |
| `state()`, `text()`, `cells()` | Read terminal state. |
| `get_command()`, `get_output()`, `get_exit_code()` | Read command state. |
| `get_cwd()`, `get_cursor()`, `get_size()`, `get_title()` | Read terminal fields. |
| `get_clipboard()` | Read the session clipboard. |
| `get_bell_count()`, `get_bell_events()` | Read bells. |
| `wait_command()`, `wait_exit()`, `wait_ready()`, `wait_idle()` | Wait for state. |
| `wait_title()`, `wait_clipboard()`, `wait_bell()` | Wait for events. |
| `expect_title()`, `expect_output()`, `expect_exit_code()` | Assert state. |
| `expect_bell_count()`, `expect_snapshot()` | Assert bells or snapshots. |
| `screenshot()` | Read text or save SVG or PNG. |
| `start_recording()`, `stop_recording()` | Record. |
| `close()`, `close_quiet()` | Close. |

Capture options: `background` and `transparent` (SVG, APNG, and GIF).

`restart(graceful_timeout=5000)` returns an `OpenResult` typed dictionary, preserving the last successful spawn's original working directory, options, and latest terminal size. The timeout is milliseconds after Ctrl-C before forced replacement; `0` skips the wait. Child exit preserves restart metadata; `close()` clears it. The terminal and automatic recording start fresh.

Constructor options: `backend`, `timeouts`, `profile`, `artifacts`, `recording`, `trace`, and `screen_history_limit`.

Use `trace={"mode": "on-failure", "directory": "traces"}`. Traces default to `"off"`. Users can open `trace.html` or replay `session.cast`; agents should read `trace.md`, `trace.json`, and `timeline.json`.

Failure artifact modes are `none`, `text`, `html`, and `all`. Use `include_recording=True` to include the cast.

## Input helpers

```python
await terminal.keyboard.press("Ctrl+C")
await terminal.mouse.click(10, 5, button="right", ctrl=True)
```

Keyboard: `press`, `down`, `repeat`, and `up`.

Named keys include arrows, Home, End, PageUp, PageDown, Insert, Delete, Backspace, Tab, Enter, Space, Escape, and F1 through F12. Join modifiers with `+`.

Mouse: `click`, `move`, `down`, `up`, `drag`, and `scroll`.

## Test helpers

```python
from tui_test.testing import terminal

async with terminal(program=("my-app",)) as app:
    await app.get_by_text("Ready").expect()
```

Helpers: `create_terminal`, `terminal`, `close_all_tracked`, `set_terminal_defaults`, `reset_terminal_defaults`, and `terminal_snapshot`.

## Errors

`ExpectationError`, `UsageError`, `NoSessionError`, and `InternalError` extend `TuiTestError`.

Full API: [bindings/python/README.md](https://github.com/microsoft/tui-test/blob/main/bindings/python/README.md)
