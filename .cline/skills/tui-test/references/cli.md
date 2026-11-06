# CLI

Use the CLI for terminal work split across separate commands. Install it separately using the [upstream instructions](https://github.com/microsoft/tui-test#installation); the JavaScript package is library-only.

[Back to the skill](../SKILL.md)

## Start

| Command | Use |
| --- | --- |
| `open [options]` | Open a shell. |
| `run [options] PROGRAM [ARGS...]` | Run an app. |
| `[global options] -- PROGRAM [ARGS...]` | Alias for `run`. |
| `restart [--graceful-timeout MS]` | Restart the session. |
| `sessions` | List sessions. |
| `close [--all]` | Close sessions. |

Use `--session NAME` to select a session. `open` and `run` reuse it unless `--restart` is set.

`open` and `run` accept `--screen-history-limit COUNT` to control how many distinct recent screens are retained for failures.

`restart` replays the last successful spawn, preserving its original working directory, options, and latest terminal size. It sends Ctrl-C and waits up to 5000 ms before forcing replacement; `--graceful-timeout 0` skips the wait. It works after child exit, but not after `close` or daemon shutdown. The terminal and automatic recording start fresh.

## Locate text

```sh
tui-test find text "Save"
tui-test expect text "Save" --fg green
tui-test click text "Save" --after-text "Settings"
tui-test highlight text 'item \d+' --regex
```

Common options:

| Option | Use |
| --- | --- |
| `--regex` | Match a regular expression. |
| `--full` | Include scrollback. |
| `--whitespace exact\|normalize` | Match whitespace. |
| `--after-text TEXT` | Search after an anchor. |
| `--before-text TEXT` | Search before an anchor. |
| `--match any\|unique\|first\|last` | Select matches. |
| `--nth N` | Select a zero-based match. |

Style options: `--fg`, `--bg`, `--bold`, `--dim`, `--italic`, `--underline-style`, `--underline-color`, `--inverse`, `--hidden`, `--strikethrough`, and `--blink`.

`--link URL` matches that hyperlink on every cell, including spaces.
Use `--link ""` for unlinked cells. Other style filters ignore spaces.

`--link` is a separate whole-match constraint, not a style field. Native
Rust/JavaScript/Python locators also support cell-set AND/OR and locator-based
containment filters; the CLI does not expose a shell expression syntax for
those operations. Locator protocol requests carry expression queries rather
than native binding stage arrays.

`click text` also accepts `--button left|middle|right`, `--alt`, `--ctrl`, `--shift`, `--clicks`, and `--timeout`.

## Send input

| Command | Use |
| --- | --- |
| `submit [TEXT]` | Type and press Enter. |
| `type TEXT` | Type text. |
| `write DATA` | Write raw bytes. |
| `key press KEYS...` | Press keys. |
| `key down\|repeat\|up KEYS...` | Send key events. |
| `mouse click [X Y] [options]` | Click a cell or `--on-text`. |
| `mouse move X Y` | Move the pointer. |
| `mouse down\|up X Y [options]` | Press or release a button. |
| `mouse drag X1 Y1 X2 Y2 [options]` | Drag. |
| `mouse scroll up\|down [--amount N]` | Scroll. |
| `resize COLS ROWS` | Resize. |
| `signal NAME` | Send a signal. |

Mouse button options are `--button left|middle|right`, `--alt`, `--ctrl`, and `--shift`.

## Wait

| Command | Use |
| --- | --- |
| `wait command` | Wait for `submit`. |
| `wait exit` | Wait for `run`. |
| `wait ready` | Wait for a prompt. |
| `wait idle` | Wait for the screen to settle. |
| `wait title TEXT` | Wait for a title. |
| `wait clipboard [TEXT]` | Wait for a clipboard change or match. |
| `wait bell` | Wait for a bell. |

Most waits accept `--timeout MS`. `expect`, `click`, and `highlight` retry. `find` reads the current screen.

## Inspect

| Command | Use |
| --- | --- |
| `state` | Read session state, modes, colors, and text. |
| `text [--full]` | Read terminal text. |
| `cells X Y [W H]` | Read cells and styles. |
| `get FIELD` | Read one field. |
| `screenshot [PATH] [--background COLOR \| --transparent]` | Read text or save SVG or PNG. |

Fields: `command`, `output`, `exit-code`, `cwd`, `cursor`, `modes`, `colors`,
`size`, `title`, `clipboard`, `bells`, and `bell-events`.

## Assert

| Command | Use |
| --- | --- |
| `expect text TEXT` | Assert a locator. |
| `expect title TEXT` | Assert a title. |
| `expect output TEXT` | Assert command output. |
| `expect exit-code CODE` | Assert the last exit code. |
| `expect bell COUNT` | Wait until the cumulative bell count reaches `COUNT`. |
| `expect snapshot NAME [-u] [--include-style] [--include-title]` | Assert a snapshot. |

## Capture

| Command | Use |
| --- | --- |
| `record start PATH [--background COLOR \| --transparent]` | Start a recording. |
| `record stop` | Finish it. |
| `get-recording [SESSION]` | Read the automatic asciinema recording. |
| `monitor` | Watch a session live. |
| `monitor --interactive` | Forward keyboard, paste, and supported SGR mouse input; Ctrl+] detaches. |

Interactive monitors mirror the session's keyboard, paste, and mouse modes.

## Failure diagnostics

Configure `[trace]` before `open` or `run`. Use `mode = "on"` to retain every session or `"on-failure"` to retain failures. Users can open `trace.html` or replay `session.cast`; agents should read `trace.md`, `trace.json`, and `timeline.json`.

To write artifacts for one assertion:

```sh
tui-test --json \
  --failure-artifacts ./artifacts/failures \
  --diagnostic-context test=settings-save \
  expect text "Save" --fg green --timeout 5000
```

Artifact modes:

| Mode | Files |
| --- | --- |
| `none` | No per-failure files. |
| `text` | `failure.json`, `current.txt`, and `failure.md`. |
| `html` | A standalone `failure.html` with its diagnostic data and evidence embedded. |
| `all` | The text and HTML outputs plus `current.svg` and `timeline.json`. |

`--failure-artifact-recording` adds `session.cast`. Review artifacts before sharing because they can contain terminal output and other user data.

## Configure

```toml
[profiles.default]
scrollback = 10000

[recording]
directory = "./casts"

[trace]
mode = "on-failure"
directory = "./traces"

[diagnostics]
screen-history-limit = 10
```

Trace modes: `off`, `on-failure`, and `on`. The default is `off`.
`recording.directory` is optional and independent of `trace.directory`.
The old `recording.mode` field is rejected. Relative directories in a config
file resolve beside that file.

## Terminal modes

`get modes` and `state.modes` report boolean modes; all keys are present.
`state.mouse_mode` is `none`, `click`, `drag`, or `motion`.
Use `expect mode NAME [--off]` to check a mode.

```sh
tui-test get cursor --json          # x, y, visible, shape, color
tui-test expect cursor --hidden
tui-test expect cursor --visible --shape bar
tui-test expect cursor --x 4 --y 0
tui-test expect mode alternate_screen
tui-test expect mode bracketed_paste --off
```

`expect cursor` checks only the properties you name. Cursor visibility and
wrapping are on by default. For portable alternate-screen tests, use
`CSI ?1049 h` to enter and `CSI ?1049 l` to exit.

## Terminal colors

`get colors` and `state.colors` report `foreground`, `background`, `cursor`,
and `palette` entries that differ from the profile. Unchanged defaults use
the session profile.

```sh
tui-test get colors --json                       # foreground, background, cursor, palette
tui-test expect colors --background '#1d1f21'
tui-test expect colors --foreground 7 --cursor '#ff0000'
tui-test expect colors --palette '1=#00ff00' --palette '200=#123456'
```

Colors accept hex RGB, `r,g,b`, or an ANSI index from the session's palette.
`default` is not accepted. `expect colors` checks the named slots together;
repeat `--palette` to check multiple entries.

## Agent commands

| Command | Use |
| --- | --- |
| `usage` | Short guide. |
| `agent-context` | Exact command schema as JSON. |
| `skill` | Complete agent guide. |
| `skill --add` | Install this skill. |
