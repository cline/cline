---
name: tuistory
description: |
  Drive and test terminal apps (especially the Cline CLI TUI in apps/cli) through tuistory — named background PTY sessions that agents can read, wait on, snapshot, screenshot, and type into. Like Playwright/tmux for terminals, with reactive waiting instead of blind `sleep`.

  Use this skill when you need to:
  - Manually test or reproduce bugs in the interactive Cline TUI (`bun run cli -i`) from a headless environment
  - Run a dev server or any long-lived/interactive process in the background without hanging your tool call
  - Write or extend Playwright-style e2e tests for the TUI (`bun run test:e2e:tuistory` in apps/cli)
  - Capture text snapshots or styled PNG screenshots of a TUI screen as evidence
---

# tuistory

[tuistory](https://github.com/remorses/tuistory) wraps any terminal command in a named background PTY session backed by a Ghostty terminal emulator. Agents interact with the session via short CLI calls that return instantly; humans can `tuistory attach` to the same session to watch or intervene. No real terminal or display (`DISPLAY`) is needed — it works fully headless, which makes it the preferred way for cloud agents to exercise the Cline TUI.

It is installed as a devDependency of `@cline/cli`, so the pinned binary resolves when you run from `apps/cli`:

```bash
cd apps/cli
bunx tuistory --help   # source of truth for commands, options, and syntax
```

For full upstream docs: `curl -s https://raw.githubusercontent.com/remorses/tuistory/refs/heads/main/README.md`

## Driving the Cline TUI headlessly

Launch the TUI in an isolated environment so you don't touch real user config (`~/.cline`):

```bash
cd apps/cli
DATA_DIR=$(mktemp -d) && HOME_DIR=$(mktemp -d)
bunx tuistory -s cline --cols 120 --rows 36 \
  --env HOME=$HOME_DIR --env CLINE_DATA_DIR=$DATA_DIR \
  --env CLINE_DISABLE_CLINE_PASS_NOTICE=1 --env CLINE_TELEMETRY_DISABLED=1 \
  -- bun src/index.ts --provider anthropic -m claude-sonnet-4-6 -k test-key
```

The dummy `-k test-key` renders the full chat UI; only an actual agent turn would fail. For recorded LLM turns, use the VCR cassettes described in `apps/cli/src/tests/helpers/env.ts` (`CLINE_VCR=playback` + `CLINE_VCR_CASSETTE`). Real turns need a provider credential (e.g. `ANTHROPIC_API_KEY`, `CLINE_API_KEY`).

Then use an **observe → act → observe** loop:

```bash
# Wait reactively for the chat view — never use sleep
bunx tuistory -s cline wait "What can I do for you?" --timeout 30000

# Act, then always observe the resulting screen state
bunx tuistory -s cline type "/settings"
bunx tuistory -s cline snapshot --trim
bunx tuistory -s cline press enter
bunx tuistory -s cline snapshot --trim

# Styled PNG of the current screen (prints the file path) — good for artifacts
bunx tuistory -s cline screenshot

# Full raw output stream (snapshot shows only the visible screen)
bunx tuistory read -s cline --all

# Tear down a session YOU started (double Ctrl+C exits the TUI cleanly)
bunx tuistory -s cline press ctrl c
bunx tuistory -s cline press ctrl c
bunx tuistory -s cline close
```

## Background processes (instead of tmux)

```bash
bunx tuistory -s my-server -- bun run dev:sidecar   # returns immediately
bunx tuistory -s my-server wait "/listening|ready/i" --timeout 30000
bunx tuistory read -s my-server                     # new output since last read
bunx tuistory -s my-server restart                  # after code changes
```

## Key rules

- **Options before `--`, command after.** Everything after the first `--` is passed verbatim to the child: `tuistory -s name --cols 150 -- bun src/index.ts` is correct.
- **Snapshot after every action.** TUIs are stateful; dialogs and errors can render over the view you expect. `snapshot` reflects what the user actually sees (occluded text does not count), unlike grepping the raw stream.
- **Wait, never sleep.** `wait "text"` / `wait "/regex/i"` (case-sensitive by default) reacts as fast as the terminal updates; `wait-idle` when you don't know what to expect. Always pass `--timeout`.
- **Keys land instantly.** Unlike sleep-based scripts, a queued second keypress can leak into the next view (e.g. one Enter both accepts a slash completion and submits it).
- **Never close a session you didn't start.** Sessions are shared with humans (`tuistory attach -s name`) and other agents. Default to leaving sessions running; use `read`/`wait`/`snapshot` to inspect without disrupting.
- `--cols`/`--rows` affect TUI layout (assertions are width-sensitive); `--pixel-ratio 2` gives sharper screenshots.

## Writing e2e tests with the library API

`apps/cli/src/cli.tuistory.e2e.test.ts` (run: `bun run test:e2e:tuistory`) is the reference. The programmatic API runs in-process — no daemon:

```ts
import { launchTerminal } from "tuistory";

const session = await launchTerminal({
	command: "bun",
	args: ["src/index.ts", "--provider", "anthropic", "-k", "test-key"],
	cwd: cliRoot,
	env: isolatedEnv, // see createCliEnv() in the reference test
	cols: 120,
	rows: 36,
	waitForDataTimeout: 30_000, // CLI cold start compiles a large TS graph
});

await session.waitForText("What can I do for you?", { timeout: 30_000 });
const screen = await session.text({ trimEnd: true }); // emulated screen state
await session.type("/settings");
await session.press("enter");
session.close(); // always close in test teardown
```

Screen-state assertions can check that stale UI is *gone* (`expect(screen).not.toContain(...)`), which stream-grepping harnesses cannot. `session.text({ only: { bold: true } })` filters by style; `session.read()` returns the raw stream since the last read.
