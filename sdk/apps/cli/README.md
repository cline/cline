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

- Distinct host ID resolution is handled by `@clinebot/core/node` `createSessionHost(...)`.
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

# Disable defaults tools, spawn(subagent), teams explicitly
clite --no-tools --no-spawn --no-teams "Answer from general knowledge only"
# Require approval before each tool call
clite --require-tool-approval "Inspect and modify this repository"
# Require approval only for command execution
clite --tool-require-approval run_commands "Fix failing tests"
# Require approval for editor only
clite --tool-require-approval editor "Refactor src/index.ts for readability"

# Pipe input
cat file.txt | clite "Summarize this"

# Team workflow with persistent name
clite --team-name my-team "Plan, implement, and verify release checklist"
clite --team-name my-team "Continue yesterday's team workflow"

# Show usage stats (tokens + estimated cost when available)
clite -u --timings "Explain quantum computing"

# Override consecutive internal mistake limit for this run (default: 3)
clite --max-consecutive-mistakes 5 "Fix failing tests"
# Common with auto-approve/yolo-style runs
clite --auto-approve-all --max-consecutive-mistakes 5 "Refactor this package"
# Alias
clite --yolo --max-consecutive-mistakes 5 "Refactor this package"

# Stream structured NDJSON output
clite --json "Summarize this repository"

# Use a specific provider, model, and access token for a single prompt/task
clite -P openrouter -m google/gemini-3-pro -k sk-your-google-gemini-api-key "Set up a storybook for the frontend react ui components"
# Use a different model with the last used provider
clite -m anthropic/claude-opus-4-6 "Explain string theory"
# Refresh model catalog from provider endpoints for this run 
# to use a new model not available in the built-in model catalog yet 
clite --refresh-models -P cline -m "openai/gpt-10"

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
# In Telegram chats, use /tools, /yolo, /cwd <path>, /reset, /whereami, /stop

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
clite dev log

# Inspect local CLI/RPC process health
clite doctor
# Include historical spawn records from the shared CLI log
clite doctor --verbose
# Kill stale local RPC listeners and old CLI processes
clite doctor --fix

# Open interactive config view directly
clite config
# Running `clite` with no prompt also enters interactive mode.
# Interactive mode is rendered with the Ink TUI.
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

# INTERNAL: RPC gateway commands for host integration and runtime management
# Start the RPC gateway server
clite rpc start
clite rpc start --address 127.0.0.1:4317
# Check whether an RPC gateway is running
clite rpc status
clite rpc status --address 127.0.0.1:4317
# Request RPC gateway shutdown
clite rpc stop
clite rpc stop --address 127.0.0.1:4317
# Ensure a compatible runtime server is available (JSON output for host apps)
clite rpc ensure --address 127.0.0.1:4317 --json
# For new client to call to register with the RPC gateway
clite rpc register --address 127.0.0.1:4317 --client-type desktop --client-id code-desktop
clite rpc register --meta app=code --meta host=tauri

# Schedule agents on cron-like intervals (runs through RPC server runtime)
clite schedule create "Daily code review" \
  --cron "0 9 * * MON-FRI" \
  --prompt "Review PRs opened yesterday and summarize issues." \
  --workspace /path/to/repo \
  --provider cline \
  --model openai/gpt-5.3-codex \
  --timeout 3600 \
  --max-iterations 50 \
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

RPC runtime note:

- RPC chat payload parsers normalize invalid optional `maxIterations` values (including JSON `null`) to `undefined` so sessions do not terminate immediately with `finishReason="max_iterations"` at iteration 0.
- RPC-backed sessions share one persistent hook service per local RPC runtime server. Direct local CLI runs still use one persistent `clite hook-worker` per CLI runtime.

## Options

| Flag | Description |
|------|-------------|
| `-s, --system <prompt>` | Override the system prompt |
| `-P, --provider <id>` | Provider id (default: `cline`) |
| `-m, --model <id>` | Model id (default: `anthropic/claude-sonnet-4.6`) |
| `-k, --key <api-key>` | API key override for this run |
| `-a, --act` | Run in act mode |
| `-p, --plan` | Run in plan mode |
| `-i, --interactive` | Interactive multi-turn mode |
| `-T, --taskId <id>` | Resume an interactive task/session |
| `-n, --max-iterations <n>` | Cap agent loop iterations |
| `-t, --timeout <seconds>` | Optional run timeout in seconds |
| `-c, --cwd <path>` | Working directory for tools |
| `--config <path>` | Configuration directory (used for CLI home resolution) |
| `--hooks-dir <path>` | Additional hooks directory hint for runtime hook injection |
| `--acp` | ACP (Agent Client Protocol) mode |
| `--thinking` | Enable model reasoning when supported |
| `--reasoning-effort <none\|low\|medium\|high\|xhigh>` | Set explicit model reasoning effort (default: `none`, or `medium` when `--thinking` is set) |
| `-u, --usage` | Show token usage and estimated cost |
| `--timings` | Show timing details |
| `--json` | Output NDJSON instead of styled text |
| `--refresh-models` | Refresh the provider model catalog for this run |
| `--sandbox` | Use isolated local state instead of `~/.cline` |
| `--sandbox-dir <path>` | Sandbox state dir (default: `$CLINE_SANDBOX_DATA_DIR` or `/tmp/cline-sandbox`) |
| `--no-tools` | Disable default tools |
| `--no-spawn` | Disable `spawn_agent` |
| `--no-teams` | Disable team tools/runtime |
| `--auto-approve-all` | Skip tool approval prompts |
| `--require-tool-approval` | Require approval for every tool call |
| `--tool-enable <name>` | Explicitly enable one tool |
| `--tool-disable <name>` | Explicitly disable one tool |
| `--tool-autoapprove <name>` | Always approve one tool |
| `--tool-require-approval <name>` | Always require approval for one tool |
| `--team-name <name>` | Override the runtime team state name |
| `--mission-step-interval <n>` | Mission log update cadence in meaningful steps |
| `--mission-time-interval-ms <ms>` | Mission log update cadence in milliseconds |
| `-h, --help` | Show help (exits immediately) |
| `-v, --verbose` | Show verbose runtime diagnostics |
| `-V, --version` | Show version (exits immediately) |

`--json` is non-interactive and requires either a prompt argument or piped stdin.

Top-level commands:

- `clite config` - Open the interactive config view
- `clite task|t [options] <prompt>` - Legacy command alias for running a task
- `clite history|h [options]` - Legacy command alias for listing history
- `clite version` - Show CLI version
- `clite update [options]` - Reserved command; currently prints a not-implemented message
- `clite auth <provider>` - Authenticate or seed provider credentials
- `clite connect <adapter>` - Run a chat connector bridge (`telegram`, `gchat`, `whatsapp`)
- `clite connect --stop [adapter]` - Stop connector bridge processes and their sessions
- `clite list <workflows|rules|skills|agents|history|hooks|mcp>` - List configs, history, or hook paths
- `clite schedule <command>` - Create and manage scheduled runs
- `clite sessions <list|update|delete>` - Inspect or edit saved sessions
- `clite dev log` - Open the CLI runtime log file
- `clite doctor` - Inspect local CLI/RPC health and stale processes
- `clite hook` - Handle a hook payload from stdin
- `clite rpc <command>` - Manage the local RPC runtime server

Connector shortcuts:

- `clite connect telegram -m <bot> -k <token>` - Start the Telegram bridge
- `clite connect gchat --base-url <url>` - Start the Google Chat webhook bridge
- `clite connect whatsapp --base-url <url>` - Start the WhatsApp webhook bridge
- `clite connect <adapter> --help` - Show adapter-specific options and examples
- `--hook-command <command>` - Run a shell command for connector events

RPC and schedule shortcuts:

- `clite rpc <start|status|stop|ensure> [--address <host:port>]` - Manage the RPC server
- `clite rpc register --client-type <type> --client-id <id>` - Register a client with the RPC server
- `clite rpc ensure --json` - Ensure the current build's compatible RPC sidecar and print JSON
- `clite schedule create <name> --cron "<expr>" --prompt "<text>" --workspace <path>` - Create a scheduled run
- `clite schedule <create|list|get|update|pause|resume|delete|trigger|history|stats|active|upcoming|import|export>` - Manage schedules and execution history

Behavior notes:

- `clite auth` without a provider opens the interactive auth setup TUI.
- Connector slash commands are shared across connector chat surfaces: `/reset`, `/whereami`, `/tools`, `/yolo`, `/cwd <path>`, `/stop`.
- Interactive CLI can use the same slash-command parser only when `CLINE_ENABLE_CHAT_COMMANDS=1`.

Auth quick-setup flags:

- `-P, --provider <id>`
- `-k, --apikey <key>`
- `-m, --modelid <id>`
- `-b, --baseurl <url>` (OpenAI/OpenAI-compatible quick setup)

MCP list examples:

```bash
clite list mcp
clite list mcp --json
```

## Tool Approval

Tool calls are auto-approved by default. Use approval flags to enforce review per tool call.

```bash
# Require approval for all tools
clite --require-tool-approval "Inspect and modify this repository"

# Require approval for editor only
clite --tool-require-approval editor "Update the changelog and README"

# Require approval for all tools, but allow reads without prompts
clite --require-tool-approval --tool-autoapprove read_files "Audit the current workspace"
```

When approval is required, the CLI prompts in TTY mode:

```text
Approve tool "<tool_name>" with input <preview>? [y/N]
```

- Enter `y` or `yes` to approve.
- Enter anything else (or press Enter) to reject.
- If stdin/stdout is not a TTY, required-approval calls are denied in terminal mode.
- RPC-backed prompt runs also honor required approvals: approval requests are relayed through RPC, prompted in the CLI TTY, and responded back to the runtime before tool execution continues.

Desktop-integrated approval mode is also supported via env wiring:

- `CLINE_TOOL_APPROVAL_MODE=desktop`
- `CLINE_TOOL_APPROVAL_DIR=<path>`

In desktop mode, CLI writes a request JSON file and waits for a matching decision JSON file.

## RPC Server

`clite rpc start` starts the `@clinebot/rpc` gRPC gateway.

- Default address: `127.0.0.1:4317`
- Override with `--address <host:port>` or `CLINE_RPC_ADDRESS`
- Startup behavior: checks health first; if already running at that address, it prints the running server id and exits without starting a duplicate
- Status check: `clite rpc status` prints running/not-running and returns exit code `0` when healthy (`1` when not running)
- Shutdown: `clite rpc stop` requests graceful shutdown for the target address; `clite rpc start` can also be stopped with Ctrl+C / `SIGTERM`
- Ensure: `clite rpc ensure` reuses the current build's compatible sidecar when possible; if an older or foreign listener is present it can launch a fresh sidecar on a new available port and report that effective address
- Compatibility check: `rpc ensure` requires runtime chat methods including `StartRuntimeSession`, `SendRuntimeSession`, `AbortRuntimeSession`, and `StopRuntimeSession`.
- Client registration: `clite rpc register --client-type <type> [--client-id <id>] [--meta key=value]...` registers host identity for RPC clients
- Runtime APIs: `clite rpc start` wires server-side runtime handlers for `StartRuntimeSession`, `SendRuntimeSession`, and `AbortRuntimeSession` (used by `@clinebot/code` and CLI runtime actions)
- Runtime event bridge: runtime handlers publish live `runtime.chat.*` events via RPC `PublishEvent`, so subscribed clients can consume real-time text/tool updates through `StreamEvents`
- Team event bridge: runtime handlers also publish typed team progress/lifecycle events (`runtime.team.progress.v1`, `runtime.team.lifecycle.v1`) with status-board projections
- Tool approval bridge: runtime handlers publish `approval.requested` and wait for RPC responses; CLI prompt runs consume these requests and return approval decisions through RPC.
- CLI streaming: RPC-backed prompt runs subscribe to `runtime.chat.*` during each turn, so text/tool output is rendered incrementally in the terminal.
- Prompt startup behavior: regular `clite "<prompt>"` runs try to connect directly to `CLINE_RPC_ADDRESS` first. If no server is running, one is spawned in the background and the CLI waits briefly for it to bind. If the background spawn fails, the CLI falls back to an in-process local runtime.

## Environment Variables

- `ANTHROPIC_API_KEY` - API key for Anthropic
- `CLINE_API_KEY` - API key for Cline (when using `-P cline`)
- `CLINE_DATA_DIR` - Base data directory for sessions/settings/teams/hooks
- `CLINE_SANDBOX` - Set to `1` to force sandbox mode
- `CLINE_SANDBOX_DATA_DIR` - Override sandbox state directory
- `CLINE_TEAM_DATA_DIR` - Override team persistence directory
- `CLINE_RPC_ADDRESS` - Address used by `clite rpc start` (default `127.0.0.1:4317`)
- `CLINE_TOOL_APPROVAL_MODE` - Approval mode (`desktop` uses file IPC; unset uses terminal prompt)
- `CLINE_TOOL_APPROVAL_DIR` - Directory for desktop approval request/decision files
- `CLINE_LOG_ENABLED` - Set to `0`/`false` to disable runtime file logging
- `CLINE_LOG_LEVEL` - Runtime log level (`trace|debug|info|warn|error|fatal|silent`, default `info`)
- `CLINE_LOG_PATH` - Runtime log file path (default `<CLINE_DATA_DIR>/logs/clite.log`)
- `CLINE_LOG_NAME` - Logger name embedded in runtime log records
- `OPENAI_API_KEY` - API key for OpenAI (when using `-p openai`)
- `OPENROUTER_API_KEY` - API key for OpenRouter (when using `-P openrouter`)
- `AI_GATEWAY_API_KEY` - API key for Vercel AI Gateway (when using `-p vercel-ai-gateway`)

`--key` takes precedence over environment variables.

For OAuth providers (`cline`, `openai-codex`, `oca`), authenticate explicitly with `clite auth <provider>`. Normal command startup does not auto-launch OAuth.

## Logging Adapter

`clite` uses a `pino`-backed adapter that targets the core `BasicLogger` contract:

- CLI runtime passes `logger` directly into local `@clinebot/core` sessions.
- RPC-backed sessions include a serialized logger payload in `RpcChatStartSessionRequest.logger`; the RPC runtime reconstructs the same `pino` settings and injects them into core.
- Hosts can attach stable runtime logger bindings (for example `clientId`, `clientType`, `clientApp`) through `RpcChatRuntimeLoggerConfig.bindings`.
- `clite rpc register` and `clite rpc start` emit activation/registration log records so startup ownership is visible in logs.
- Logger behavior is consistent between local and RPC runtime execution paths while preserving a transport-safe config boundary.

After login, OAuth credentials are persisted with `auth.expiresAt`, and `@clinebot/core` refreshes these tokens automatically during session turns (including long-lived RPC runtime sessions).

On startup, `clite` also attempts a legacy settings import:

- Source files: `<CLINE_DATA_DIR>/globalState.json` and `<CLINE_DATA_DIR>/secrets.json`
- Target file: `<CLINE_DATA_DIR>/settings/providers.json` (or `CLINE_PROVIDER_SETTINGS_PATH`)
- Existing providers in `providers.json` are never overwritten
- Missing providers discovered in legacy files are merged into `providers.json`
- Migrated provider entries are annotated with `tokenSource: "migration"`

Custom provider registry notes:

- Provider runtime settings continue to persist in `<CLINE_DATA_DIR>/settings/providers.json`.
- User-added OpenAI-compatible provider model catalogs are persisted in `<CLINE_DATA_DIR>/settings/models.json` (or alongside `CLINE_PROVIDER_SETTINGS_PATH`).
- `models.json` stores model lists by provider ID and is loaded by RPC runtime provider actions.

## Features

- **Streaming output** - Responses stream in real-time
- **Stable stream rendering** - Prefers structured agent events and avoids duplicate text/tool output when chunk mirrors are also emitted
- **Sub-agent spawning** - `spawn_agent` is available by default unless disabled
- **Recursive delegation** - Sub-agents spawned via `spawn_agent` also receive `spawn_agent` when spawn is enabled
- **Agent teams runtime** - Team tools (tasks/mailbox/mission log) are available by default unless disabled
- Team tools keep related operations grouped where that improves usability (for example `team_task` uses an `action` field, while teammate/runs/mailbox/outcome tools stay separate)
- **Pipe support** - Accepts piped input for processing files
- **Interactive mode** - Multi-turn conversations
- **JSON output mode** - NDJSON records for run lifecycle, agent/team events, and final result (`--json`)
- **Minimal dependencies** - Fast startup time
- **Multiple providers** - Works with Anthropic, OpenAI, and more

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
