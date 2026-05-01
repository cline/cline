# Cline CLI Lite

Cline CLI built with Cline SDK.

Streams output in real time and includes built-in tools, sub-agent spawning, and team runtime support by default.

Detailed CLI command/feature reference is centralized in [`DOC.md`](./DOC.md).


## Requirements

- [Bun](https://bun.com/docs/installation) (for development, build, and running `clite`)

## Installation

> NOTE: The package is not published yet, so the CLI is not available on npm. To use the CLI, you can clone the repository and link the package locally with `bun link` from the `@clinebot/cli` workspace. Global installation from npm will be available after the initial release.

```bash
npm i -g @clinebot/cli
# or
bun i -g @clinebot/cli
```

## Development

Quick Start:

```bash
# From Root of the repository
bun install
bun run build

bun run cli # Run Dev script for the CLI package 
# or
bun run -F @clinebot/cli dev "your prompt" # Run the CLI from the package workspace
# or
bun link # Link the package globally for easy access from anywhere
# Run from the linked binary
clite auth

# Run built CLI with Bun
bun cli/dist/index.js "your prompt"
```

Dev runtime note:

- Distinct host ID resolution is handled by `@clinebot/core` `createRuntimeHost(...)`.
- When no explicit `distinctId` is provided, core uses `node-machine-id` first and only persists a generated fallback at `<session-data-dir>/machine-id` if machine ID lookup is unavailable.

## Publishing

From the @clinebot/cli package workspace:

```bash
# Package the latest model list from models.dev
bun run build:models

# Dry run for checking package size and build output
bun publish --dry-run
# Example Output: Total files: 3 / Unpacked size: 2.28MB

# Publish to npm with Bun (version bump required)
bun run release
```

## Testing

```bash

# Run CLI unit tests
bun -F @clinebot/cli test:unit

# Run CLI e2e tests
bun -F @clinebot/cli test:e2e
bun -F @clinebot/cli test:e2e:interactive
```

## Usage

```bash
# Start Cline CLI without a prompt to enter interactive mode
clite

# Single prompt / One-shot - includes tools + spawn + teams
clite "Audit this package and propose fixes"
# NOTE: Single-prompt runs are non-interactive and exit when the turn finishes

# Interactive mode
clite -i
# With custom system prompt
clite -i -s "You are a pirate" "Tell me about the sea"
clite -i "Let's work on this together. First, analyze the current state and suggest next steps."

# Require approval before each tool call
clite --auto-approve false "Inspect and modify this repository"
# Explicitly enable auto-approval for all tools
clite --auto-approve true "Refactor src/index.ts for readability"

# Pipe input
cat file.txt | clite "Summarize this"

# Team workflow with persistent name
clite --team-name my-team "Plan, implement, and verify release checklist"
clite --team-name my-team "Continue yesterday's team workflow"

# Show verbose run stats (includes elapsed time, tokens, and estimated cost when available)
clite -v "Explain quantum computing"

# Override consecutive internal mistake (retry) limit for this run (default: 3)
clite --retries 5 "Fix failing tests"
# Common with auto-approve/yolo-style runs
clite --auto-approve true --retries 5 "Refactor this package"

# Explicit yolo also enables submit_and_exit and disables spawn/team tools by default
clite --yolo --retries 5 "Refactor this package"

# Zen mode: fire-and-forget a task to the background hub and exit the CLI immediately
# The hub keeps running the task; the menubar app (if installed) will notify you on
# completion. Otherwise check `clite history` later to see the result.
clite --zen "Refactor the authentication module"

# Stream structured NDJSON output
clite --json "Summarize this repository"

# Use a specific provider, model, and access token for a single prompt/task
clite -P openrouter -m google/gemini-3-pro -k sk-your-google-gemini-api-key "Set up a storybook for the frontend react ui components"
# Use a different model with the last used provider
clite -m anthropic/claude-opus-4-6 "Explain string theory"

# Quick setup with API key/model
clite auth --provider anthropic --apikey sk-... --modelid claude-sonnet-4-6
clite auth --provider openai-native --apikey sk-... --modelid gpt-5 --baseurl https://api.example.com/v1

# Authenticate OAuth providers explicitly
clite auth <cline|openai-codex|oca>

# Bridge a Telegram bot into RPC-backed chat sessions (polling mode)
clite connect telegram -m my_bot -k 123456:ABCDEF...
# Foreground mode for local debugging / logs in the active terminal
clite connect telegram -i -m my_bot -k 123456:ABCDEF...
# Reuse the last-used provider/model, but keep tools off by default for safety
# Override provider/model if needed
clite connect telegram -m my_bot -k 123456:ABCDEF... --provider cline --model openai/gpt-5.3-codex
# Enable tools explicitly only if you trust the Telegram surface
clite connect telegram -m my_bot -k 123456:ABCDEF... --enable-tools
# Dispatch connector lifecycle/message events to an external hook command
clite connect telegram -m my_bot -k 123456:ABCDEF... --hook-command '/Users/me/bin/on-connector-event'
# In Telegram chats, use /tools, /yolo, /cwd <path>, /clear, /whereami, /exit

# Bridge a Google Chat app into RPC-backed chat sessions (webhook mode)
clite connect gchat --base-url https://your-domain.com
# Foreground mode for local debugging / logs in the active terminal
clite connect gchat -i --base-url https://your-domain.com --port 8787
# Receive all-space messages through Workspace Events / Pub/Sub
clite connect gchat --base-url https://your-domain.com --pubsub-topic projects/my-project/topics/chat-events --impersonate-user admin@example.com
# Enable tools explicitly only if you trust the Google Chat surface
clite connect gchat --base-url https://your-domain.com --enable-tools

# Bridge a WhatsApp Business webhook into RPC-backed chat sessions
clite connect whatsapp --base-url https://your-domain.com
# Foreground mode for local debugging / logs in the active terminal
clite connect whatsapp -i --base-url https://your-domain.com --port 8787
# Override Meta credentials directly instead of relying on environment variables
clite connect whatsapp --base-url https://your-domain.com --phone-number-id 1234567890 --access-token token --app-secret secret --verify-token verify
# Enable tools explicitly only if you trust the WhatsApp surface
clite connect whatsapp --base-url https://your-domain.com --enable-tools

# Stop connector bridges and delete their sessions
clite connect --stop
clite connect --stop telegram
clite connect --stop gchat
clite connect --stop whatsapp

# Connector implementation notes
# - adapter files keep transport-specific setup and schedule-delivery rules
# - shared logic for flags/process helpers, thread bindings, session bootstrap,
#   and turn/approval handling lives under apps/cli/src/connectors/

# Open the CLI runtime log file
clite doctor log

# Inspect local CLI/RPC process health
clite doctor
# Include historical spawn records from the shared CLI log
clite doctor --verbose
# Kill stale local RPC listeners and old CLI processes
clite doctor fix

# Open interactive config view directly
clite config
# Running `clite` with no prompt also enters interactive mode.
# Interactive mode is rendered with the OpenTUI TUI.
# The initial screen uses a WelcomeView-style layout before the first prompt.
# Inline composer supports completion menus:
# - `@` opens workspace file mention search (arrow keys to move, Enter/Tab to insert)
# - `/` opens workflow slash command search (arrow keys to move, Enter/Tab to insert)
# - `/config` (or `/settings`) opens the interactive config browser
#   with tabs for workflows, rules, skills, hooks, and agents
# Footer rows mirror the legacy CLI layout:
# 1) command/file hint + Plan/Act badges (Tab)
# 2) provider/model + context bar + token/cost
# 3) repo/branch + git diff stats
# 4) auto-approve state (Shift+Tab toggles)
# For one-shot auto-exit behavior, pass a prompt argument.
# Exit interactive mode with Ctrl+D (or Ctrl+C when idle).

# Schedule agents on cron-like intervals
clite schedule create "Daily code review" \
  --cron "0 9 * * MON-FRI" \
  --prompt "Review PRs opened yesterday and summarize issues." \
  --workspace /path/to/repo \
  --provider cline \
  --model openai/gpt-5.3-codex \
  --timeout 3600 \
  --tags automation,review

# Route a scheduled result back to a Telegram thread handled by the connector
# First, send /whereami to your bot in Telegram to get the thread id
clite schedule create "Daily summary" \
  --cron "0 9 * * *" \
  --prompt "Summarize yesterday's activity in this workspace." \
  --workspace /path/to/repo \
  --delivery-adapter telegram \
  --delivery-bot my_bot \
  --delivery-thread telegram:123456789
clite schedule list
clite schedule get <schedule-id>
clite schedule trigger <schedule-id>
clite schedule history <schedule-id> --limit 20
clite schedule stats <schedule-id>
clite schedule active
clite schedule upcoming --limit 10
clite schedule export <schedule-id> > daily-review.yaml
clite schedule import ./daily-review.yaml
```

## OAuth Authentication

`clite` supports OAuth login for:

- `cline`
- `openai-codex`
- `oca`

`clite` does not auto-start OAuth during normal command startup. Authenticate explicitly first with `clite auth <provider>`.

For non-interactive runs, if one of these providers is selected and no saved credentials are available, `clite` fails fast with an authentication message instead of launching a hidden browser flow.

During OAuth login, `clite` tries to open the authorization URL in your default browser automatically and still prints the URL for manual fallback.

`clite auth` (without a provider) opens the interactive auth TUI with the same auth options as the old CLI flow:

- Sign in with Cline
- Sign in with ChatGPT Subscription (`openai-codex`)
- Sign in with OCA
- Use your own API key (provider + model + optional base URL)

Runtime note:

- Hook dispatch now runs in-process against the active runtime session instead of spinning up a separate `clite hook-worker` service.

## Options

| Flag | Description |
|------|-------------|
| `-s, --system <prompt>` | Override the system prompt |
| `-P, --provider <id>` | Provider id (default: `cline`) |
| `-m, --model <id>` | Model id (default: `anthropic/claude-sonnet-4.6`) |
| `-k, --key <api-key>` | API key override for this run |
| `-p, --plan` | Run in plan mode. Default to act mode. |
| `-i, --tui` | Interactive TUI multi-turn mode |
| `-t, --timeout <seconds>` | Optional run timeout in seconds |
| `-c, --cwd <path>` | Working directory for tools |
| `--config <path>` | Configuration directory (used for CLI home resolution) |
| `--hooks-dir <path>` | Additional hooks directory hint for runtime hook injection |
| `--acp` | ACP (Agent Client Protocol) mode |
| `--thinking [none\|low\|medium\|high\|xhigh]` | Set model thinking level when supported. Defaults to `medium` when the flag is provided without a level; thinking is off when the flag is omitted. |
| `--retries <count>` | Maximum consecutive mistakes (retries) before halting (default: `3`) |
| `--json` | Output NDJSON instead of styled text |
| `--data-dir <path>` | Use isolated local state at `<path>` instead of `~/.cline` (enables sandbox mode automatically) |
| `--auto-approve [true\|false]` | Set tool auto-approval for all tools |
| `-y, --yolo` | Skip tool approval prompts, enable `submit_and_exit`, and disable spawn/team tools by default |
| `-z, --zen` | Dispatch the task to the background hub and exit the CLI immediately (see "Zen mode" below) |
| `--team-name <name>` | Override the runtime team state name |
| `-h, --help` | Show help (exits immediately) |
| `-v, --verbose` | Show verbose runtime diagnostics |
| `-V, --version` | Show version (exits immediately) |

`--json` is non-interactive and requires either a prompt argument or piped stdin.

Top-level commands:

- `clite config` - Open the interactive config view
- `clite history|h [options]` - List session history or manage saved sessions
- `clite version` - Show CLI version
- `clite update [options]` - Reserved command; currently prints a not-implemented message
- `clite auth <provider>` - Authenticate or seed provider credentials
- `clite connect <adapter>` - Run a chat connector bridge (`telegram`, `gchat`, `whatsapp`)
- `clite connect --stop [adapter]` - Stop connector bridge processes and their sessions
- `clite schedule <command>` - Create and manage scheduled runs
- `clite doctor` - Inspect local CLI health and stale processes
- `clite doctor fix` - Kill stale local RPC listeners and old CLI processes
- `clite doctor log` - Open the CLI runtime log file
- `clite hook` - Handle a hook payload from stdin
- `clite hub` - Manage the local hub daemon
- `clite kanban` - Launch the external `kanban` app and exit (requires `npm i -g kanban`)

Connector shortcuts:

- `clite connect telegram -m <bot> -k <token>` - Start the Telegram bridge
- `clite connect gchat --base-url <url>` - Start the Google Chat webhook bridge
- `clite connect whatsapp --base-url <url>` - Start the WhatsApp webhook bridge
- `clite connect <adapter> --help` - Show adapter-specific options and examples
- `--hook-command <command>` - Run a shell command for connector events

Schedule shortcuts:

- `clite schedule create <name> --cron "<expr>" --prompt "<text>" --workspace <path>` - Create a scheduled run
- `clite schedule <create|list|get|update|pause|resume|delete|trigger|history|stats|active|upcoming|import|export>` - Manage schedules and execution history

Behavior notes:

- `clite auth` without a provider opens the interactive auth setup TUI.
- Connector slash commands are shared across connector chat surfaces: `/clear`, `/whereami`, `/tools`, `/yolo`, `/cwd <path>`, `/exit`.
- Interactive CLI can use the shared slash-command parser when `CLINE_ENABLE_CHAT_COMMANDS=1`.
- `/team <task>` is handled directly by the CLI in both interactive and non-interactive runs, even when chat commands are otherwise disabled.

Auth quick-setup flags:

- `-P, --provider <id>`
- `-k, --apikey <key>`
- `-m, --modelid <id>`
- `-b, --baseurl <url>` (OpenAI/OpenAI-compatible quick setup)

## Zen Mode

`--zen` (alias `-z`) runs a task in the background hub daemon and exits the CLI immediately. It is intended for long-running tasks you want to fire off and walk away from.

```bash
# Fire off a task and return to your shell right away
clite --zen "Refactor the authentication module and add unit tests"
```

Behavior:

- The CLI starts (or reuses) the local hub daemon, submits the task, then exits. It does not stream output or stay attached to the session.
- Because there is no human in the loop once the CLI exits, zen sessions run with full tool auto-approval (same semantics as `--yolo`). `spawn`/`team` tools are disabled by default for safety, consistent with yolo-mode defaults.
- If the Cline menubar app is running, it subscribes to hub `ui.notify` events and will surface a system notification when the task completes.
- If the menubar app is not running, there is no live UI for the task. Use `clite history` later to find the session and inspect the result.
- `--zen` is incompatible with `--data-dir` (the implicit sandbox requires a local backend that exits with the CLI) and with `--tui` (there is no terminal UI to render into).

## Tool Approval

Tool calls are auto-approved by default. Use `--auto-approve false` to require review before tool execution.

```bash
# Require approval for all tools
clite --auto-approve false "Inspect and modify this repository"

# Explicitly keep approvals disabled for this run
clite --auto-approve true "Audit the current workspace"
```

When approval is required, the CLI prompts in TTY mode:

```text
Approve tool "<tool_name>" with input <preview>? [y/N]
```

- Enter `y` or `yes` to approve.
- Enter anything else (or press Enter) to reject.
- If stdin/stdout is not a TTY, required-approval calls are denied in terminal mode.

Desktop-integrated approval mode is also supported via env wiring:

- `CLINE_TOOL_APPROVAL_MODE=desktop`
- `CLINE_TOOL_APPROVAL_DIR=<path>`

In desktop mode, CLI writes a request JSON file and waits for a matching decision JSON file.

## Environment Variables

- `ANTHROPIC_API_KEY` - API key for Anthropic
- `CLINE_API_KEY` - API key for Cline (when using `-P cline`)
- `CLINE_DATA_DIR` - Base data directory for sessions/settings/teams/hooks
- `CLINE_SANDBOX` - Set to `1` to force sandbox mode
- `CLINE_SANDBOX_DATA_DIR` - Override sandbox state directory
- `CLINE_TEAM_DATA_DIR` - Override team persistence directory
- `CLINE_BUILD_ENV` - Runtime build mode for SDK-owned subprocess launches (`development` adds `node|bun --inspect=127.0.0.1:0 --enable-source-maps` by default; falls back to `NODE_ENV` or `--conditions=development`)
- `CLINE_DEBUG_HOST` - Override the host used for development inspector listeners (default `127.0.0.1`)
- `CLINE_DEBUG_PORT_BASE` - Override the base inspector port for development child processes; when unset, child processes use ephemeral inspector ports
- `CLINE_TOOL_APPROVAL_MODE` - Approval mode (`desktop` uses file IPC; unset uses terminal prompt)
- `CLINE_TOOL_APPROVAL_DIR` - Directory for desktop approval request/decision files
- `CLINE_LOG_ENABLED` - Set to `0`/`false` to disable runtime file logging
- `CLINE_LOG_LEVEL` - Runtime log level (`trace|debug|info|warn|error|fatal|silent`, default `info`)
- `CLINE_LOG_PATH` - Runtime log file path (default `<CLINE_DATA_DIR>/logs/cline.log`)
- `CLINE_LOG_NAME` - Logger name embedded in runtime log records
- `OPENAI_API_KEY` - API key for OpenAI (when using `-p openai`)
- `OPENROUTER_API_KEY` - API key for OpenRouter (when using `-P openrouter`)
- `AI_GATEWAY_API_KEY` - API key for Vercel AI Gateway (when using `-p vercel-ai-gateway`)
- `V0_API_KEY` - API key for v0 (when using `-P v0`)

`--key` takes precedence over environment variables.

For OAuth providers (`cline`, `openai-codex`, `oca`), authenticate explicitly with `clite auth <provider>`. Normal command startup does not auto-launch OAuth.

## Debugging

- `CLINE_BUILD_ENV=development` enables debugger ports for SDK-owned spawned Node/Bun subprocesses.
- By default, child processes use ephemeral inspector ports to avoid collisions.
- Set `CLINE_DEBUG_PORT_BASE=9230` if you want deterministic role-based ports such as hook worker `9231`, plugin sandbox `9232`, connector child `9233`.
- Those ports do not apply to the top-level CLI when it is running under Bun. To debug the Bun CLI process itself, launch the real CLI entrypoint under Bun with an inspector port such as:

```bash
cd apps/cli
CLINE_BUILD_ENV=development bun --conditions=development --inspect-brk=6499 ./src/index.ts "hey"
```

- The workspace includes [.vscode/launch.json](./.vscode/launch.json) with a single `Launch CLI Debugger` compound entry for VS Code. It launches `apps/cli/src/index.ts` directly under Bun in development mode and attaches the common SDK child-process debuggers.
- The launch config uses `"type": "bun"` (requires the [`oven.bun-vscode`](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode) extension). Using `type: node` will not work because breakpoints in the CLI and workspace packages like `packages/core` will be silently ignored.
- Attach configs use `"url": "ws://127.0.0.1:<port>"` with `localRoot`/`remoteRoot` both set to `${workspaceFolder}`. This lets the Bun debug adapter resolve source maps for files loaded through workspace symlinks (for example `node_modules/@clinebot/core` to `packages/core/src/...`), so breakpoints set in `packages/core` hit correctly.

## Logging Adapter

`clite` uses a `pino`-backed adapter that targets the core `BasicLogger` contract:

- CLI runtime passes `logger` directly into local `@clinebot/core` sessions.
- Hub-backed sessions include a serialized logger payload in `ChatStartSessionRequest.logger`; the runtime reconstructs the same `pino` settings and injects them into core.
- Hosts can attach stable runtime logger bindings (for example `clientId`, `clientType`, `clientApp`) through `RuntimeLoggerConfig.bindings`.

After login, OAuth credentials are persisted with `auth.expiresAt`, and `@clinebot/core` refreshes these tokens automatically during session turns.

On startup, `clite` also attempts a legacy settings import:

- Source files: `<CLINE_DATA_DIR>/globalState.json` and `<CLINE_DATA_DIR>/secrets.json`
- Target file: `<CLINE_DATA_DIR>/settings/providers.json` (or `CLINE_PROVIDER_SETTINGS_PATH`)
- Existing providers in `providers.json` are never overwritten
- Missing providers discovered in legacy files are merged into `providers.json`
- Migrated provider entries are annotated with `tokenSource: "migration"`

Custom provider registry notes:

- Provider runtime settings continue to persist in `<CLINE_DATA_DIR>/settings/providers.json`.
- Providers in `providers.json` can opt into the OpenAI Responses API with `"protocol": "openai-responses"`; this routes the runtime through the OpenAI client while keeping the user-defined provider ID, base URL, and model catalog.
- User-added OpenAI-compatible provider model catalogs are persisted in `<CLINE_DATA_DIR>/settings/models.json` (or alongside `CLINE_PROVIDER_SETTINGS_PATH`).
- `models.json` stores model lists by provider ID and is loaded by the runtime provider actions.
- Entries with only `models` extend an existing provider; entries with `provider` metadata register or override a custom provider.

## Features

- Streaming output - Responses stream in real-time
- Stable stream rendering - Prefers structured agent events and avoids duplicate text/tool output when chunk mirrors are also emitted
- Sub-agent spawning - `spawn_agent` is available by default unless disabled
- Recursive delegation - Sub-agents spawned via `spawn_agent` also receive `spawn_agent` when spawn is enabled
- Agent teams runtime - Team tools (tasks/mailbox/mission log) are available by default unless disabled
- Team tools keep related operations grouped where that improves usability (for example `team_task` uses an `action` field, while teammate/runs/mailbox/outcome tools stay separate)
- Pipe support - Accepts piped input for processing files
- Interactive mode - Multi-turn conversations
- JSON output mode - NDJSON records for run lifecycle, agent/team events, and final result (`--json`)
- Minimal dependencies - Fast startup time
- Multiple providers - Works with Anthropic, OpenAI, and more
- Configurable reasoning effort - Adjust model reasoning depth per run

## Runtime Ownership

- CLI renders runtime events and handles terminal UX.
- Core owns agent creation, runtime composition, and session message persistence.
- CLI does not directly instantiate `Agent` for chat/task execution.
- CLI does not perform direct file/db message persistence in run/interactive paths.
- CLI owns the user-instruction watcher (rules/workflows/skills) because prompt assembly uses rule context before session start; the watcher is disposed on all exit paths.
- RPC runtime uses the same prompt resolver and accepts optional `rules` in runtime config (or `systemPrompt` when fully prebuilt by the caller).

### Connector runtime behavior

- Telegram, Google Chat, and WhatsApp all reuse the same shared connector runtime formatting path.
- Assistant text streams incrementally into the chat surface.
- Tool activity is summarized as compact start/error messages with short argument previews.
- Required tool approvals are posted back into the chat thread and accept `Y` / `N` replies.
- Google Chat serves its webhook at `/api/webhooks/gchat`; configure the Google Chat App URL as `<base-url>/api/webhooks/gchat`.
- Webhook-based connectors are hosted through a shared CLI `node:http` server helper rather than `Bun.serve`.
- WhatsApp serves its webhook at `/api/webhooks/whatsapp`; configure the Meta callback URL as `<base-url>/api/webhooks/whatsapp`.
