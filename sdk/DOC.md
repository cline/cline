# Cline SDK DOC

This document is the single detailed API and behavior reference for this repository.

For architecture and runtime flow details, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## `@clinebot/agents`


API reference and package boundary notes for `@clinebot/agents`.

## Scope

`@clinebot/agents` owns runtime primitives:

- Agent loop execution (`Agent`)
- Tool primitives (definition, validation, execution helpers)
- Runtime interception (extensions + hooks)
- Team primitives (sub-agents, mission/task coordination)
- Streaming/event helpers

`@clinebot/agents` does not own stateful app orchestration. Use `@clinebot/core` for persistent sessions, runtime assembly, and storage.

Workspace boundary note:
- import llms contracts from `@clinebot/llms/node` (or `@clinebot/llms/browser` for browser hosts)
- do not use other `@clinebot/llms/*` deep imports

## Primary Exports

### Core Agent

- `Agent`
- `createAgent`

### Extensions

- `AgentExtensionRunner`
- `createExtensionRunner`
- `discoverExtensionModules`
- `loadExtensionModule`
- `loadExtensionsFromPaths`

### Hooks

- Core lifecycle engine exports (`HookEngine`, `HookHandler`) from `@clinebot/agents`
- Node-only subprocess hook helpers from `@clinebot/agents/node`:
  - `createPersistentSubprocessHooks`
  - `createSubprocessHooks`
  - `runHook`
  - `HookEventName`
  - `HookEventPayload`
  - `ToolCallHookPayload`
  - `ToolResultHookPayload`
  - `AgentEndHookPayload`
  - `SessionShutdownHookPayload`

### Tools

- `createTool`
- `createToolRegistry`
- `executeTool`
- `executeToolWithRetry`
- `executeToolsSequentially`
- `executeToolsInParallel`
- `validateToolDefinition`
- `validateToolInput`
- `toToolDefinition`
- `toToolDefinitions`

### Teams

- `AgentTeamsRuntime`
- `bootstrapAgentTeams`
- `createAgentTeamsTools`
- `createSpawnAgentTool`
- `createAgentTeam`
- `createWorkerReviewerTeam`

#### Team Tool Surface

`createAgentTeamsTools` provides a compact team tool surface:

- `team_spawn_teammate`
- `team_shutdown_teammate`
- `team_task`
- `team_status`
- `team_run_task`
- `team_cancel_run`
- `team_list_runs`
- `team_await_run`
- `team_await_all_runs`
- `team_send_message`
- `team_broadcast`
- `team_read_mailbox`
- `team_log_update`
- `team_create_outcome`
- `team_attach_outcome_fragment`
- `team_review_outcome_fragment`
- `team_finalize_outcome`
- `team_list_outcomes`
- `team_cleanup`

### Streaming

- `streamRun`
- `streamContinue`
- `streamText`
- `batchEvents`
- `collectEvents`
- `filterEvents`
- `mapEvents`

### Default Tools

- `createBuiltinTools`
- `createDefaultTools`
- `createDefaultToolsWithPreset`
- `createReadFilesTool`
- `createSearchTool`
- `createBashTool`
- `createEditorTool`
- `createWebFetchTool`

## Extensions vs Hooks

- `extensions` in `AgentConfig` handle policy/plugin composition
- `setup(api)` registers runtime additions (tools, commands, shortcuts, flags, renderers, providers)
- `hooks` in `AgentConfig` handle lifecycle callbacks
- subprocess hook integrations are provided by `@clinebot/agents/node` or upstream runtime layers (for example `@clinebot/core`)

Extension command note:

- Extension/plugin commands are registered through `api.registerCommand(...)`.
- The agent/runtime contribution registry owns collecting those commands.
- Host layers such as the CLI can adapt the collected extension commands into host-specific command surfaces, such as the chat command host used by interactive mode and connectors.

Control fields returned by extension/hook handlers:

- `cancel: boolean` to abort execution
- `context: string` to append model-visible control context
- `overrideInput: unknown` to rewrite active user input

## Migration Notes

When splitting responsibilities:

- Keep `Agent`, tools, hooks/extensions, and team runtime code in `@clinebot/agents`
- Move session managers, storage-backed lifecycle handling, and runtime composition into `@clinebot/core`
- Depend on `@clinebot/core` from app hosts (CLI/desktop), and depend on `@clinebot/agents` for runtime primitives

## Minimal Runtime Example

```ts
import { Agent, createBuiltinTools } from "@clinebot/agents/node"

const agent = new Agent({
	providerId: "anthropic",
	modelId: "claude-sonnet-4-5-20250929",
	apiKey: process.env.ANTHROPIC_API_KEY,
	systemPrompt: "You are a coding assistant.",
	tools: createBuiltinTools({
		cwd: process.cwd(),
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
		enableEditor: true,
		enableSkills: true,
		enableAskQuestion: true,
	}),
})

const result = await agent.run("Summarize this repository.")
console.log(result.text)
```

## Codex Provider Tool Behavior

`openai-codex` is different from providers that support SDK-defined custom tools.

- Do not pass custom tool definitions to the Codex provider.
- Do not rely on model `tool_calls` from `openai-codex` being executable by `@clinebot/agents`.
- Codex may still use its own built-in provider-native tools internally.
- Provider-native Codex tool events are treated as informational provider behavior and are not forwarded into local tool execution, which avoids `Unknown tool` errors for built-in Codex tools.

Practical effect:
- If you disable session tools for `openai-codex`, local Cline tools stay off.
- Codex can still use its built-in tools inside the provider runtime.
- Those built-in tool invocations are not mapped onto the Cline tool registry.

## `@clinebot/core` Telemetry

`@clinebot/core` exposes a lightweight `TelemetryService` from `@clinebot/core` and an OpenTelemetry-backed factory from the lazy subpath `@clinebot/core/telemetry/opentelemetry`.

Use `createOpenTelemetryTelemetryService` when you want the SDK to configure OpenTelemetry log and metric exporters for you and return a `telemetry` service that can be passed through the rest of the SDK:

```ts
import { createSessionHost } from "@clinebot/core/node"
import { createConfiguredTelemetryService } from "@clinebot/core/telemetry/opentelemetry"
import {
	createClineTelemetryServiceConfig,
	createClineTelemetryServiceMetadata,
} from "@clinebot/shared";

const config = createClineTelemetryServiceConfig({
  metadata: createClineTelemetryServiceMetadata({
    extension_version: version,
    cline_type: "cli",
    platform: "terminal",
    platform_version: process.version,
    os_type: process.platform,
    os_version: "unknown",
  }),
});

const { telemetry, provider } = createConfiguredTelemetryService(config);

const host = await createSessionHost({
	telemetry,
})

const started = await host.start({
	config: {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: process.env.ANTHROPIC_API_KEY,
		systemPrompt: "You are a coding assistant.",
		cwd: process.cwd(),
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		telemetry,
	},
	prompt: "Summarize this repository.",
})

await telemetry.flush()
await provider.dispose()
```

Notes:
- `telemetry` can be passed either at host construction time (`createSessionHost({ telemetry })`) or directly on `CoreSessionConfig`.
- Core resolves a default distinct ID from `node-machine-id` and uses that for both telemetry services and session hosts unless you pass an explicit `distinctId` override.
- The session manager emits basic lifecycle events including `session.started`, `session.input_sent`, `session.aborted`, and `session.stopped`.
- The OpenTelemetry provider subpath stays separate from the main core barrel so OpenTelemetry code is only loaded when you import it.

## `@clinebot/core` Interactive Queueing

Interactive session sends support queued follow-up turns through the session manager and runtime RPC layer.

- Runtime turn requests accept `delivery?: "queue" | "steer"`.
- `delivery: "queue"` stores the prompt as a pending turn and returns without running it immediately.
- `delivery: "steer"` stores the prompt as a pending turn at the front of the queue.
- Queued entries preserve `userImages` / `userFiles` attachments.
- Core emits `pending_prompts` snapshots whenever the queue changes.
- Core emits `pending_prompt_submitted` when a queued prompt is promoted into the active turn.

Practical host guidance:

- Treat the core queue as the source of truth for pending prompts.
- Subscribe to queue events instead of maintaining a separate host-side turn queue.
- If you render transcripts, keep the original queued user line if desired, and append a normal user line when `pending_prompt_submitted` arrives.


## `@clinebot/cli`


> **Package:** `@clinebot/cli` · **Binary:** `clite` · **Version:** `0.0.0`
> **Runtime:** [Bun](https://bun.sh) / Node · **Language:** TypeScript (ESM)
> **License:** Apache-2.0

---

## Table of Contents

- [Cline SDK DOC](#cline-sdk-doc)
  - [`@clinebot/agents`](#clinebotagents)
  - [Scope](#scope)
  - [Primary Exports](#primary-exports)
    - [Core Agent](#core-agent)
    - [Extensions](#extensions)
    - [Hooks](#hooks)
    - [Tools](#tools)
    - [Teams](#teams)
      - [Team Tool Surface](#team-tool-surface)
    - [Streaming](#streaming)
    - [Default Tools](#default-tools)
  - [Extensions vs Hooks](#extensions-vs-hooks)
  - [Migration Notes](#migration-notes)
  - [Minimal Runtime Example](#minimal-runtime-example)
  - [`@clinebot/core` Telemetry](#clinebotcore-telemetry)
  - [`@clinebot/cli`](#clinebotcli)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Installation \& Build](#installation--build)
  - [CLI Entry Point \& Argument Parsing](#cli-entry-point--argument-parsing)
    - [Argument Parser (`parseArgs`)](#argument-parser-parseargs)
  - [Commands \& Subcommands](#commands--subcommands)
    - [1. Single-Shot Mode](#1-single-shot-mode)
    - [2. Interactive Mode (`-i`)](#2-interactive-mode--i)
    - [3. Pipe / Stdin Mode](#3-pipe--stdin-mode)
    - [4. Config View (`config`)](#4-config-view-config)
    - [5. Auth Subcommand](#5-auth-subcommand)
    - [6. Dev Subcommand](#6-dev-subcommand)
    - [7. Doctor Subcommand](#7-doctor-subcommand)
    - [8. List Subcommand](#8-list-subcommand)
    - [9. Sessions Subcommand](#9-sessions-subcommand)
      - [`sessions list`](#sessions-list)
      - [`sessions delete --session-id <id>`](#sessions-delete---session-id-id)
    - [10. Hook Subcommand](#10-hook-subcommand)
    - [11. RPC Subcommand](#11-rpc-subcommand)
  - [All Flags \& Options](#all-flags--options)
  - [Features In Depth](#features-in-depth)
    - [Streaming Output \& Event Handling](#streaming-output--event-handling)
    - [Tools System](#tools-system)
      - [Tool Approval Policies](#tool-approval-policies)
      - [How User Approval Works in CLI](#how-user-approval-works-in-cli)
    - [Sandbox Mode](#sandbox-mode)
    - [Sub-Agent Spawning](#sub-agent-spawning)
    - [Agent Teams (`--teams`)](#agent-teams---teams)
    - [Session Management](#session-management)
      - [Session Lifecycle](#session-lifecycle)
      - [Session ID](#session-id)
      - [Session Resumption](#session-resumption)
    - [Hook System](#hook-system)
      - [How Hooks Are Wired](#how-hooks-are-wired)
      - [Hook Payload Structure](#hook-payload-structure)
      - [Hook Audit Log](#hook-audit-log)
    - [Provider \& Model Configuration](#provider--model-configuration)
      - [Provider Selection](#provider-selection)
      - [Model Selection](#model-selection)
      - [Live Model Catalog](#live-model-catalog)
      - [Supported Providers](#supported-providers)
      - [OAuth Authentication](#oauth-authentication)
    - [RPC Server](#rpc-server)
    - [Workflow Slash Commands](#workflow-slash-commands)
  - [Environment Variables](#environment-variables)
  - [Configuration Object (`Config`)](#configuration-object-config)
  - [Internal Architecture](#internal-architecture)
  - [Examples](#examples)

---

## Overview

`@clinebot/cli` is a fast, lightweight command-line interface for running **agentic loops** powered by large language models (LLMs). It is designed for minimal startup latency and real-time streaming output.

Key design principles:
- **Speed-first** — minimal dependencies, Bun-compiled output, streaming from first token
- **Composable** — pipe input, chain with shell scripts, spawn sub-agents
- **Persistent** — every session is recorded (SQLite + file artifacts) with full transcripts and message history
- **Extensible** — pluggable tool system, multi-provider support, agent teams, RPC server integration

---

## Installation & Build

```bash
# From the monorepo root
bun install
bun run build        # runs bun.mts build script → dist/

# Run directly without building
bun ./src/index.ts "your prompt"

# After build, the binary is available as:
clite "your prompt"
```

**Build scripts** (from `package.json`):

| Script | Command |
|--------|---------|
| `build` | `rm -rf dist && bun run bun.mts` |
| `build:binary` | `bun build ./src/index.ts --compile --outfile ./dist/clite --external @anthropic-ai/vertex-sdk` |
| `dev` | `bun ./src/index.ts` |
| `clean` | `rm -rf dist node_modules` |
| `typecheck` | `tsc --noEmit` |

The compiled output is placed at `./dist/index.js` and exposed via `"bin": { "clite": "dist/index.js" }` in `package.json`. A standalone binary can be built via `build:binary`.

---

## CLI Entry Point & Argument Parsing

**Source:** `src/index.ts` — thin entry point, calls `runCli()` from `src/main.ts`
**Main logic:** `src/main.ts` → `runCli()`
**Arg parser:** `src/utils/helpers.ts` → `parseArgs(args: string[])`

The entry point (`src/index.ts`) installs flush handlers for the logger adapter, then calls `runCli()`. On unhandled error it writes to stderr and exits 1.

`runCli()` performs the following steps on startup:

1. **Set home dir** via `setHomeDir(homedir())`
2. **Install stream error guards** (EPIPE protection)
3. **Parse arguments** via `parseArgs(process.argv.slice(2))`
4. **Check for `config` prefix** — if `rawArgs[0] === "config"`, sets interactive mode and strips the prefix
5. **Configure sandbox** if `--sandbox` or `CLINE_SANDBOX=1`
6. **Load `ProviderSettingsManager`** — migrates legacy settings on startup
7. **Dispatch special subcommands** — `hook`, `hook-worker`, `rpc`, `auth`, `doctor`, `list`, `sessions` are dispatched before any session is created
8. **Handle `--session <id>`** — forces interactive mode and sets `resumeSessionId`
9. **Validate flags** (`--output`, `--mode`)
10. **Resolve provider & API key** — flag → persisted settings; non-interactive runs fail fast if the selected OAuth-backed provider is not authenticated
11. **Optionally refresh live model catalog** — only if `--refresh-models` is passed
12. **Assemble `Config`** object
13. **Persist provider settings** for future runs
14. **Read piped stdin** only when fd 0 is actually a pipe/file/socket and not interactive
15. **Dispatch** to `runInteractive()` or `runAgent()`

### Argument Parser (`parseArgs`)

`parseArgs` performs a single left-to-right scan of the argument list. It recognises:

- **Flags** (e.g. `-i`, `--no-tools`) — set boolean fields on `ParsedArgs`
- **Value flags** (e.g. `-m claude-opus-4`, `--cwd /tmp`) — consume the next token as the value
- **Positional arguments** — everything that does not start with `-` is joined with spaces and becomes the `prompt`

```typescript
interface ParsedArgs {
  prompt?: string               // positional args joined
  systemPrompt?: string         // -s / --system
  key?: string                  // -k / --key
  interactive: boolean          // -i / --interactive
  showHelp: boolean             // -h / --help
  showVersion: boolean          // -v / --version
  showUsage: boolean            // -u / --usage
  showTimings: boolean          // -t / --timings
  thinking: boolean             // --thinking
  liveModelCatalog: boolean     // --refresh-models
  outputMode: "text" | "json"   // --output / --json
  mode: "act" | "plan"          // --mode
  invalidOutputMode?: string    // invalid --output value (error path)
  invalidMode?: string          // invalid --mode value (error path)
  sandbox: boolean              // --sandbox
  sandboxDir?: string           // --sandbox-dir
  enableSpawnAgent: boolean     // --spawn / --enable-spawn (default true)
  enableAgentTeams: boolean     // --teams (default true)
  enableTools: boolean          // --tools (default true) / --no-tools
  defaultToolAutoApprove: boolean  // --auto-approve-tools (default true)
  toolPolicies: Record<string, ToolPolicy>  // --tool-enable/disable/autoapprove/require-approval
  model?: string                // -m / --model
  provider?: string             // -p / --provider
  sessionId?: string            // --session
  maxIterations?: number        // -n / --max-iterations (optional; unset is unbounded)
  maxConsecutiveMistakes?: number   // --max-consecutive-mistakes (default 3)
  invalidMaxConsecutiveMistakes?: string // warning-only invalid value capture
  cwd?: string                  // --cwd
  teamName?: string             // --team-name
  missionLogIntervalSteps?: number  // --mission-step-interval
  missionLogIntervalMs?: number     // --mission-time-interval-ms
}
```

---

## Commands & Subcommands

### 1. Single-Shot Mode

**Usage:**
```bash
clite "your prompt here"
clite --no-tools "What is 2+2?"
clite -s "You are a pirate" "Tell me about the sea"
clite -m claude-opus-4-5-20251101 "Explain string theory"
clite -u -t "Explain quantum computing"
clite --mode plan "Outline a refactor strategy for this codebase"
```

**How it works:**

Single-shot mode is the default when a prompt is provided as a positional argument (and `-i` is not set). It calls `runAgent(prompt, config)` in `src/runtime/run-agent.ts`:

1. Resolves a Cline welcome line (credit balance) if using the `cline` provider
2. Records start time (`performance.now()`)
3. Prewarms the file index for the working directory
4. Creates runtime hooks (one persistent hook worker for that CLI runtime, or disabled in `--yolo`)
5. Creates a `CliSessionManager` via `createDefaultCliSessionManager()`
6. Subscribes to agent events via `subscribeToAgentEvents()`
7. Registers SIGINT/SIGTERM handlers that call `sessionManager.abort()`
8. Calls `sessionManager.start()` to create the session, then `sessionManager.send()` with the prompt
9. Streams events to stdout via `handleEvent()`
10. Optionally prints timing and token usage stats
11. Calls `sessionManager.stop()` and `sessionManager.dispose()` in the `finally` block

**Abort behaviour:**
Pressing Ctrl+C triggers SIGINT → `sessionManager.abort(activeSessionId)`. The session is marked `cancelled`.

**Output format:**
Tool calls are shown inline:
```
[tool_name] <input summary>
  -> <output summary>
```

---

### 2. Interactive Mode (`-i`)

**Usage:**
```bash
clite -i
clite -i -s "You are an expert Python developer"
clite -i --teams --team-name my-team
clite --session <session-id>   # resume a previous session
```

**How it works:**

Interactive mode is activated by `-i` / `--interactive`, by passing no prompt, or via `--session`. It calls `runInteractive(config, ...)` in `src/runtime/run-interactive.ts`:

1. Validates that both stdin and stdout are TTYs (exits if not)
2. Resolves a Cline welcome line if applicable
3. Prewarms the file index
4. Creates runtime hooks and a `CliSessionManager`
5. Loads resume messages if `--session <id>` was passed
6. Calls `sessionManager.start()` to create or restore the session
7. Renders the **Ink TUI** (`InteractiveTui` React component) — a fully interactive terminal UI
8. Each user input is sent via `sessionManager.send()`, streaming events to the TUI via `EventEmitter`
9. SIGINT during a run aborts the current turn; SIGINT when idle exits cleanly

**TUI features:**
- Multi-turn conversation with full history display
- `/config` and `/settings` slash commands to open the config browser
- A shared chat command host for built-in and plugin-defined slash commands
- Workflow and skill slash commands loaded from the workspace watcher/runtime command registry
- Auto-approve toggle
- File mention support (`@file`)

---

### 3. Pipe / Stdin Mode

**Usage:**
```bash
echo "Summarize this" | clite
cat src/index.ts | clite "Review this code for bugs"
git diff | clite "Write a commit message for this diff"
```

**How it works:**

When `--interactive` is not set and fd 0 is a readable pipe, file, or socket, the CLI reads all stdin bytes before starting the agent. If a positional prompt was also given, it is prepended:

```
<user prompt>

<piped stdin content>
```

If no positional prompt is given, the piped content alone becomes the prompt.

---

### 4. Config View (`config`)

**Usage:**
```bash
clite config
```

**How it works:**

When `rawArgs[0]` is `"config"`, the CLI strips the prefix and forces interactive mode with `initialView: "config"`. This opens the Ink TUI directly on the config browser screen. All other flags still apply (provider, model, etc.).

---

### 5. Auth Subcommand

**Usage:**
```bash
clite auth                          # interactive provider selection
clite auth cline                    # OAuth login for Cline
clite auth openai-codex             # OAuth login for OpenAI Codex
clite auth oca                      # OAuth login for OCA
clite auth --provider anthropic --apikey sk-xxx --modelid claude-sonnet-4-6
```

**Source:** `src/commands/auth.ts` → `runAuthCommand()`

Dispatched when `rawArgs[0] === "auth"`. It:
1. Parses auth-specific args (`--provider`/`-p`, `--apikey`/`-k`, `--modelid`/`-m`, `--baseurl`/`-b`)
2. If a known OAuth provider is specified, opens the OAuth browser flow
3. If `--apikey` is passed, performs a quick-setup save via `ProviderSettingsManager`

**Supported OAuth providers:** `cline`, `openai-codex`, `oca`

---

### 6. Dev Subcommand

**Usage:**
```bash
clite dev log
```

**Source:** `src/commands/dev.ts` → `runDevCommand()`

Dispatched when `rawArgs[0] === "dev"`. Currently supported:
1. `log` - opens the CLI runtime log file at `~/.cline/data/logs/clite.log` (resolved through `resolveClineDataDir()`), creating the file first if it does not exist.

---

### 7. Doctor Subcommand

**Usage:**
```bash
clite doctor
clite doctor --fix
clite doctor --json
```

**Source:** `src/commands/doctor.ts` → `runDoctorCommand()`

Dispatched when `rawArgs[0] === "doctor"`. It inspects local CLI health by:
1. Checking RPC server health on the configured address
2. Listing local RPC listener PIDs
3. Listing stale local CLI processes

With `--fix`, it also attempts local cleanup by terminating stale RPC listeners and old CLI processes. With `--json`, it writes a machine-readable report to stdout.

---

### 8. List Subcommand

**Usage:**
```bash
clite list workflows          # list available workflow configs
clite list rules              # list rule configs
clite list skills             # list skill configs
clite list agents             # list agent configs
clite list history            # list recent session history
clite list history --limit 50
clite list hooks              # list hook config file paths
clite list mcp                # list MCP server registrations
clite list workflows --json   # JSON output
```

**Source:** `src/commands/list.ts` → `runListCommand()`, `runHistoryListCommand()`

Dispatched when `rawArgs[0] === "list"`. Targets:

| Target | Source |
|---|---|
| `workflows` | `resolveWorkflowsConfigSearchPaths(cwd)` |
| `rules` | `resolveRulesConfigSearchPaths(cwd)` |
| `skills` | `resolveSkillsConfigSearchPaths(cwd)` |
| `agents` | `~/Documents/Cline/Agents` and `$CLINE_DATA_DIR/settings/agents` |
| `history` | Session DB via `listSessions(limit)` |
| `hooks` | `listHookConfigFiles()` |
| `mcp` | `resolveMcpServerRegistrations()` |

All list commands support `--output json` / `--json` for machine-readable output.

---

### 9. Sessions Subcommand

**Usage:**
```bash
clite sessions list
clite sessions list --limit 50
clite sessions list 50          # positional limit also works
clite sessions delete --session-id <id>
```

Dispatched when `rawArgs[0] === "sessions"`.

#### `sessions list`

Lists recent CLI sessions as a JSON array written directly to `process.stdout`. Default limit is 200. Each record includes session metadata from the underlying session store.

#### `sessions delete --session-id <id>`

Deletes a session and all its associated files. The `--session-id` flag is required (no positional form).

---

### 10. Hook Subcommand

**Usage:**
```bash
clite hook          # called internally by the CLI itself
clite hook-worker   # long-lived internal hook worker
```

**These subcommands are not intended for direct user invocation.** They are used internally by the CLI hook transport.

**Source:** `src/commands/hook.ts` → `runHookCommand()`, `runHookWorkerCommand()`

When the CLI starts a direct local agent run, it sets up `createPersistentSubprocessHooks()` from `@clinebot/agents/node` unless hooks are disabled by `--yolo`. That path starts one long-lived `clite hook-worker` subprocess for the lifetime of that CLI runtime and exchanges newline-delimited JSON request/response messages with it. If the worker transport fails, the CLI falls back to the legacy one-shot `clite hook` path.

RPC-backed sessions are different: `createRpcRuntimeHandlers()` in `apps/cli/src/commands/rpc-runtime.ts` now creates one shared persistent hook service per RPC server process and injects those hooks into all RPC runtime sessions. CLI clients talking to the RPC runtime do not each spawn their own hook worker.

The hook handler:
1. Reads the full JSON payload from stdin
2. Parses and validates it with `parseCliHookPayload()`
3. Appends the event to the session's `.hooks.jsonl` audit log (`appendHookAudit`)
4. Gets the `CoreSessionService` backend via `getCoreSessionBackend()`
5. Calls `sessions.queueSpawnRequest(payload)` — queues spawn requests
6. Calls `sessions.upsertSubagentSessionFromHook(payload)` — creates/updates sub-session records
7. Appends to the sub-agent transcript for key hook events
8. Calls `sessions.applySubagentStatus(subSessionId, payload)` — updates sub-session status
9. Writes `{}` as a JSON response to stdout

The `hook-worker` handler performs the same bookkeeping but keeps the process alive and handles multiple requests over the same stdio connection.

**Hook event types handled:**

| `hookName` | Action |
|---|---|
| `tool_call` | Audit + queue spawn if `spawn_agent` tool + transcript line |
| `tool_result` | Audit |
| `agent_start` / `agent_resume` | Audit + upsert sub-session |
| `prompt_submit` | Audit |
| `agent_abort` | Audit + status transitions |
| `agent_end` | Audit + upsert sub-session + transcript "completed" line |
| `pre_compact` | Audit |
| `session_shutdown` | Audit + transcript "shutdown" line + status update |

---

### 11. RPC Subcommand

**Usage:**
```bash
clite rpc start [--address host:port]          # start RPC server (blocks)
clite rpc status [--address host:port]         # check server health
clite rpc stop [--address host:port]           # request graceful shutdown
clite rpc ensure [--address host:port] [--json] # ensure a compatible owner-scoped server is running
clite rpc register --client-type <type> --client-id <id>  # register a client
```

**This subcommand is primarily for internal and desktop integration use.**

**Source:** `src/commands/rpc.ts`

The RPC server provides a gRPC interface (`@clinebot/rpc`) that desktop clients or other tooling can connect to for session management. Default address is `127.0.0.1:4317` (overridden by `CLINE_RPC_ADDRESS`).

Compatibility and sidecar replacement are handled by shared `@clinebot/core` ensure logic. That path uses owner-scoped discovery plus a runtime build key derived from `@clinebot/core` and `@clinebot/rpc` package versions, and can optionally be extended by hosts with a host-specific build key. When any agent command starts in RPC-backed mode, the host attempts to connect to the RPC server and starts a compatible sidecar in the background if needed.

---

## All Flags & Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--help` | `-h` | boolean | `false` | Show help text and exit |
| `--version` | `-v` | boolean | `false` | Show version and exit |
| `--interactive` | `-i` | boolean | `false` | Start interactive (multi-turn) TUI mode |
| `--system <prompt>` | `-s` | string | *(default system prompt)* | Override the system prompt |
| `--model <id>` | `-m` | string | `anthropic/claude-sonnet-4.6` | LLM model ID |
| `--provider <id>` | `-p` | string | `cline` | LLM provider ID |
| `--key <api-key>` | `-k` | string | — | API key override for this run |
| `--max-iterations <n>` | `-n` | number | *(unbounded)* | Max agentic loop iterations (optional; unset is unbounded) |
| `--max-consecutive-mistakes <n>` | — | number | `3` | Max consecutive internal mistakes before escalation (invalid values are ignored with warning) |
| `--usage` | `-u` | boolean | `false` | Print token usage and estimated cost after each run |
| `--timings` | `-t` | boolean | `false` | Print elapsed time after each run |
| `--thinking` | — | boolean | `false` | Enable model thinking/reasoning when supported |
| `--refresh-models` | — | boolean | `false` | Refresh provider model catalog from live endpoints for this run |
| `--mode <act\|plan>` | — | string | `act` | Agent mode for tool presets |
| `--output <text\|json>` | — | string | `text` | Output format (`text` or NDJSON `json`) |
| `--json` | — | boolean | `false` | Shorthand for `--output json` |
| `--sandbox` | — | boolean | `false` | Isolated local state (no writes to `~/.cline`) |
| `--sandbox-dir <path>` | — | string | `/tmp/cline-sandbox` | Sandbox state directory |
| `--tools` | — | boolean | `true` | Enable built-in tools (default on) |
| `--no-tools` | — | boolean | — | Disable all built-in tools |
| `--auto-approve-tools` | — | boolean | `true` | Auto-approve tool calls by default |
| `--yolo` | — | boolean | `false` | Auto-approve tools and disable CLI hook dispatch |
| `--require-tool-approval` | — | boolean | `false` | Require approval before each tool call by default |
| `--no-yolo` | — | boolean | `false` | Alias for `--require-tool-approval` |
| `--tool-enable <name>` | — | string | — | Explicitly enable a specific tool |
| `--tool-disable <name>` | — | string | — | Explicitly disable a specific tool |
| `--tool-autoapprove <name>` | — | string | — | Auto-approve a specific tool |
| `--tool-require-approval <name>` | — | string | — | Require approval for a specific tool |
| `--spawn` / `--enable-spawn` | — | boolean | `true` | Enable sub-agent spawning tool |
| `--no-spawn` | — | boolean | — | Disable sub-agent spawning tool |
| `--teams` | — | boolean | `true` | Enable agent teams runtime |
| `--no-teams` | — | boolean | — | Disable agent teams runtime |
| `--team-name <name>` | — | string | `agent-team-<nanoid(5)>` | Name for the agent team |
| `--cwd <path>` | — | string | `process.cwd()` | Working directory for tools |
| `--session <id>` | — | string | — | Resume interactive chat from a saved session ID |
| `--mission-step-interval <n>` | — | number | `3` | Mission log interval in steps |
| `--mission-time-interval-ms <n>` | — | number | `120000` | Mission log interval in milliseconds |

`--max-consecutive-mistakes` is a per-session override for the current run only. The counter tracks consecutive internal failures (API turn failures, invalid/missing tool-call params, and iterations where all tool calls fail). Any successful tool execution resets the counter to `0`. At the limit:
- with auto-approve/yolo-style runs (`--auto-approve-tools`), the run stops with failure
- with approval mode (`--require-tool-approval`), CLI prompts `mistake_limit_reached` and asks how to continue, then resets the counter when continuing

---

## Features In Depth

### Streaming Output & Event Handling

**Source:** `handleEvent(event: AgentEvent, config: Config)` in `src/events.ts`

All agent output is streamed in real-time. The SDK emits `content_start` / `content_end` events with a `contentType` discriminator:

| Event | `contentType` | Output |
|---|---|---|
| `content_start` | `text` | Raw text written immediately to stdout (inline streamed) |
| `content_start` | `reasoning` | `[thinking] <text>` in dim — shown when `--thinking` is on |
| `content_start` | `tool` | `\n[tool_name] <input summary>` in dim/cyan |
| `content_end` | `tool` (success) | `  -> <output summary>` in dim, or ` ok` in green |
| `content_end` | `tool` (error) | ` error: <message>` in red |
| `done` | — | `── finished: <reason> (<n> iterations) ──` in dim |
| `error` | — | `error: <message>` in red (to stderr) |
| `iteration_start` | — | `none` |

When `--output json` (or `--json`) is used, output switches to **NDJSON**:
- each line is a JSON object with `ts` and event payload
- event records include `run_start`, `agent_event`, `team_event`, `run_result`, `hook_event`, `run_abort_requested`, `team_restored`
- error records are emitted as JSON to stderr: `{ "type": "error", "message": "..." }`
- interactive mode is rejected in JSON mode; use a prompt argument or piped stdin

**Tool input formatting** (`formatToolInput` in `src/utils/helpers.ts`):

| Tool | Display |
|---|---|
| `run_commands` | Commands joined with `; ` (truncated to 60 chars each) |
| `read_files` | File paths joined with `, ` (truncated to 40 chars each) |
| `search_codebase` | Queries joined with `, ` |
| `fetch_web_content` | URLs from `requests[].url` joined with `, ` |
| `spawn_agent` | Task description (50 chars) |
| `skills` | `<skill> <args>` (70 chars) |
| `ask_followup_question` | Question text (70 chars) |
| `team_spawn_teammate` | `<agentId>: <rolePrompt>` |
| `team_shutdown_teammate` | `shutdown <agentId>` |
| `team_task` | `create <title>` / `list status=<status\|any> readyOnly=<bool>` / `claim <taskId>` / `complete <taskId>: <summary>` / `block <taskId>: <reason>` |
| `team_run_task` | `<runMode> <agentId>: <task>` (70 chars) |
| `team_cancel_run` | `cancel <runId>` |
| `team_await_run` | `<runId>` |
| `team_await_all_runs` | `all runs` |
| `team_send_message` | `<toAgentId>: <subject>` |
| `team_broadcast` | `<subject>` |
| `team_read_mailbox` | `read unreadOnly=<bool> limit=<n\|default>` |
| `team_create_outcome` | `<title>` |
| `team_attach_outcome_fragment` | `<outcomeId>/<section>` |
| `team_review_outcome_fragment` | `<fragmentId>: <approved>` |
| `team_finalize_outcome` | `<outcomeId>` |
| `team_list_outcomes` | `list` |

**ANSI color scheme** (defined in `src/utils/output.ts`, no external dependencies):

| Color | Usage |
|---|---|
| `dim` | Tool calls, metadata, separators, hook output |
| `cyan` | Tool input values, teammate IDs |
| `green` | Successful tool output (`ok`) |
| `red` | Errors |
| `yellow` | Iteration markers (dev mode) |
| `bold` | Help headings |

---

### Tools System

**Source:** `src/runtime/run-agent.ts`, `src/runtime/run-interactive.ts`

Tools are enabled by default. Pass `--no-tools` to disable all built-in tools. Tool assembly is handled by the session service — the CLI passes flags and tool policies to `sessionManager.start()`.

**Built-in tools** (provided by `@clinebot/core`):

| Tool | Description |
|---|---|
| `read_files` | Read one or more files from the filesystem |
| `search_codebase` | Regex/glob search across the codebase |
| `run_commands` | Execute shell commands |
| `fetch_web_content` | Fetch and analyse web pages |
| `ask_followup_question` | Ask the user a clarifying question |
| `skills` | Execute configured workflow skills |

All built-in tools are scoped to `cwd`.

#### Tool Approval Policies

Tool approvals are policy-based:
- Global default is controlled by `--auto-approve-tools` (default) or `--require-tool-approval`
- Per-tool overrides use `--tool-autoapprove <name>` and `--tool-require-approval <name>`
- Enable or disable specific tools with `--tool-enable <name>` and `--tool-disable <name>`
- Policies are assembled as `Record<string, ToolPolicy>` with a `"*"` wildcard key for the global default

Example — require approval for shell commands only:
```bash
clite --tool-require-approval run_commands "Update the changelog"
```

#### How User Approval Works in CLI

When a tool call requires approval, the terminal shows:
```
Approve tool "<tool_name>" with input <preview>? [y/N]
```

- `y` / `yes`: approve and execute
- Any other input (including empty Enter): reject
- Non-TTY contexts: approval-required tools are auto-denied

In interactive (TUI) mode, the auto-approve state can be toggled live via the TUI controls.

---

### Sandbox Mode

**Source:** `configureSandboxEnvironment()` in `src/utils/helpers.ts`

Passing `--sandbox` (or setting `CLINE_SANDBOX=1`) isolates all CLI data from `~/.cline`. It sets the following environment variables so all subsystems redirect to the sandbox dir:

```
CLINE_SANDBOX=1
CLINE_SANDBOX_DATA_DIR=<dir>
CLINE_DATA_DIR=<dir>
CLINE_SESSION_DATA_DIR=<dir>/sessions
CLINE_TEAM_DATA_DIR=<dir>/teams
CLINE_PROVIDER_SETTINGS_PATH=<dir>/settings/providers.json
CLINE_HOOKS_LOG_PATH=<dir>/hooks/hooks.jsonl
```

Default sandbox dir: `$CLINE_SANDBOX_DATA_DIR` env → `/tmp/cline-sandbox`. Override with `--sandbox-dir <path>`.

---

### Sub-Agent Spawning

**Usage:**
```bash
clite "Research and summarise the top 5 AI papers from 2024"   # spawn enabled by default
clite --no-spawn "Simple task, no sub-agents needed"
```

Sub-agent spawning is enabled by default. Pass `--no-spawn` to disable.

When enabled, the agent gains access to a `spawn_agent` tool that delegates subtasks to child agents. Sub-agents inherit the parent's provider, model, and working directory, and can themselves spawn further sub-agents.

Sub-agent sessions are tracked by the session backend with `parent_agent_id` / `parent_session_id` linkage.

---

### Agent Teams (`--teams`)

**Usage:**
```bash
clite --teams "Coordinate a team to write a full test suite for this codebase"
clite --teams --team-name research-team "Research quantum computing"
clite --no-teams "Simple single-agent task"
clite --teams --mission-step-interval 5 --mission-time-interval-ms 30000 "..."
```

Agent teams are enabled by default. Pass `--no-teams` to disable.

Agent teams enable the lead agent to spawn, coordinate, and communicate with multiple **teammate agents** that run concurrently.

**Team tools available to the lead agent:**

| Tool | Description |
|---|---|
| `team_spawn_teammate` | Spawn a teammate with `agentId` and `rolePrompt` |
| `team_shutdown_teammate` | Shutdown a teammate by `agentId` |
| `team_status` | Get a snapshot of all teammates, tasks, mailbox, and mission log |
| `team_task` | Manage shared tasks with `action=create|list|claim|complete|block` |
| `team_run_task` | Delegate a task to a teammate (sync or async) |
| `team_list_runs` | List async teammate runs, including live activity/progress metadata (`currentActivity`, `lastProgressMessage`, `lastProgressAt`, `heartbeatAt`) |
| `team_await_run` | Wait for one async run by `runId` (long timeout: 1 hour) |
| `team_await_all_runs` | Wait for all active async runs (long timeout: 1 hour) |
| `team_cancel_run` | Cancel one async run |
| `team_send_message` | Send a direct teammate message |
| `team_broadcast` | Broadcast a message to teammates |
| `team_read_mailbox` | Read the caller mailbox |
| `team_log_update` | Append a mission log entry |
| `team_create_outcome` | Create a final deliverable outcome |
| `team_attach_outcome_fragment` | Attach a section fragment to an outcome |
| `team_review_outcome_fragment` | Review an outcome fragment |
| `team_finalize_outcome` | Finalize an outcome |
| `team_list_outcomes` | List outcomes |
| `team_cleanup` | Clean up the team runtime |

Team state is persisted in SQLite via `SqliteTeamStore` keyed by `teamName`. On restart with the same `--team-name`, the runtime snapshot is restored and stale queued/running runs are marked interrupted before continuing.

`team_task` with `action="list"` is the discovery primitive that makes autonomous task pickup possible. Agents can inspect the shared task set, find tasks that are both unassigned and dependency-ready, then claim them with `team_task` and `action="claim"`.

### Scheduled Routines (`clite schedule`)

Schedules are RPC-backed cron jobs that start a runtime session, run a prompt, and persist execution history through `@clinebot/scheduler`.

Normal schedule behavior:
- cron decides when a schedule becomes due
- the scheduler starts one runtime session
- the scheduler sends the configured prompt
- the scheduler records execution metrics/history and stops the session

Autonomous routine behavior:
- enable it with schedule metadata `autonomous.enabled = true`
- the CLI now supports metadata patch flags `--autonomous`, `--no-autonomous`, `--idle-timeout <seconds>`, and `--poll-interval <seconds>` on `schedule create`, `schedule import`, and `schedule update`
- after the first scheduled turn, the scheduler can keep the same session alive for a bounded idle window
- on each idle poll, the lead agent is prompted to inspect `team_read_mailbox` and `team_task` with `action="list"`, claim one ready task if work exists, and continue in-session
- if no actionable work appears for the full idle window, the scheduler stops the session cleanly
- execution metrics aggregate across the initial turn and all autonomous follow-up turns

Example:

```bash
clite schedule create daily-routine \
  --cron "0 * * * *" \
  --prompt "Review open shared tasks and keep the team moving." \
  --workspace /path/to/workspace \
  --autonomous \
  --idle-timeout 60 \
  --poll-interval 5
```

**Team event display** (`handleTeamEvent` in `src/events.ts`):

| Event | Console output |
|---|---|
| `teammate_spawned` | `[team] teammate spawned: <agentId>` |
| `teammate_shutdown` | `[team] teammate shutdown: <agentId>` |
| `team_task_updated` | `[team task] <taskId> -> <status>` |
| `team_message` | `[mailbox] <from> -> <to>: <subject>` |
| `team_mission_log` | `[mission] <agentId>: <summary (90 chars)>` |
| `run_queued` / `run_started` / `run_progress` / `run_completed` / `run_failed` / `run_cancelled` / `run_interrupted` | team run lifecycle updates |

**Mission log intervals:**
- `--mission-step-interval <n>` — log every N agent steps (default: 3)
- `--mission-time-interval-ms <n>` — log every N milliseconds (default: 120000)

---

### Session Management

**Source:** `src/utils/session.ts` — `createDefaultCliSessionManager()`, `listSessions()`, `deleteSession()`

Every CLI invocation creates a **session** tracked by the `CoreSessionService`.

**Session backend:** The CLI tries to connect to an RPC server (see [RPC Server](#rpc-server)). If unavailable, it falls back to a local `CoreSessionService` with SQLite.

#### Session Lifecycle

```
runCli()
  └── createDefaultCliSessionManager()    → connect to RPC or local service
        └── sessionManager.start()        → INSERT session, create file artifacts
        └── sessionManager.send()         → run agent turn(s)
        └── sessionManager.stop()         → finalize session
        └── sessionManager.dispose()      → cleanup resources
```

#### Session ID

Session IDs are generated as:
```
${Date.now()}_${nanoid(5)}_cli
```
e.g. `1700000000000_abcde_cli`

Sub-agent sessions use deterministic IDs:
```
<rootSessionId>__<agentId>   (max 180 chars)
```

Team task sub-sessions:
```
<rootSessionId>__teamtask__<agentId>__<timestamp>_<nonce>
```

#### Session Resumption

Pass `--session <id>` to resume a previous interactive session. This:
1. Forces interactive mode
2. Loads previous messages via `loadInteractiveResumeMessages(sessionManager, resumeSessionId)`
3. Sets `CLINE_HOOK_AGENT_RESUME=1`
4. Passes initial messages to `sessionManager.start()` for context continuity

---

### Hook System

**Source:** `src/utils/hooks.ts` → `createRuntimeHooks()`
**Source:** `src/commands/hook.ts` → `runHookCommand()`, `runHookWorkerCommand()`
**Source:** `src/utils/helpers.ts` → `appendHookAudit()`, `parseCliHookPayload()`

The hook system provides a **side-channel audit trail** for agent lifecycle events. In normal direct CLI mode it uses one persistent subprocess (`clite hook-worker`) for the duration of that CLI runtime. In RPC-backed mode the RPC server owns one shared persistent hook service for all sessions handled by that server. In `--yolo` mode, CLI hook dispatch is disabled entirely. If the persistent transport fails, the runtime falls back to the legacy one-shot `clite hook` subprocess.

#### How Hooks Are Wired

```typescript
// In createRuntimeHooks():
createPersistentSubprocessHooks({
  command: [process.execPath, process.argv[1], "hook-worker"],
  env: process.env,
  cwd: process.cwd(),
  sessionContext: currentHookSessionContext,  // provides rootSessionId + hookLogPath
  onDispatch: ({ payload, result }) => { /* write inline hook output to terminal */ },
  onDispatchError: (error) => { /* log in dev mode */ },
})
```

The persistent worker receives newline-delimited JSON payloads on stdin and responds with newline-delimited JSON `{}` envelopes on stdout. The legacy `clite hook` command still accepts a single JSON payload on stdin and replies once.

In JSON output mode, each hook dispatch also emits a `hook_event` NDJSON line to stdout.

#### Hook Payload Structure

```typescript
{
  hookName: "tool_call" | "tool_result" | "agent_start" | "agent_resume" | "agent_abort"
         | "prompt_submit" | "agent_end" | "pre_compact" | "session_shutdown",
  taskId: string,
  clineVersion: string,
  timestamp: string,
  workspaceRoots: string[],
  userId: string,
  agent_id: string,
  parent_agent_id: string | null,
  sessionContext?: { rootSessionId: string, hookLogPath: string },
  tool_call?: { id: string, name: string, input: unknown },
  tool_result?: { name: string, output: unknown },
  reason?: string   // for session_shutdown
}
```

#### Hook Audit Log

Every hook event is appended to a `.hooks.jsonl` file. The path is resolved in priority order:
1. `payload.sessionContext.hookLogPath`
2. `CLINE_HOOKS_LOG_PATH` env var
3. Default fallback in the hook log dir

Each line is a newline-delimited JSON record with a `ts` timestamp prepended.

---

### Provider & Model Configuration

**Source:** `src/main.ts` → `runCli()`, `ProviderSettingsManager` from `@clinebot/core/node`

#### Provider Selection

The provider is resolved in this order:
1. `-p` / `--provider` flag
2. `ProviderSettingsManager.getLastUsedProviderSettings().provider` (persisted from last run)
3. Default: `anthropic`

#### Model Selection

The model is resolved in this order:
1. `-m` / `--model` flag
2. `ProviderSettingsManager.getProviderSettings(provider).model` (persisted per-provider)
3. First model ID from the live catalog (if `--refresh-models` was used)
4. Default: `anthropic/claude-sonnet-4.6`

#### Live Model Catalog

The live model catalog is **not fetched by default**. Pass `--refresh-models` to fetch it for the current run:

```typescript
const resolvedProviderConfig = await providers.resolveProviderConfig(provider, {
  loadLatestOnInit: true,
  loadPrivateOnAuth: true,
  failOnError: false,
})
```

If the refresh fails, it logs a dim warning and falls back to bundled defaults. The catalog source is shown in the model info line:
```
[model] provider=anthropic model=claude-sonnet-4-6 catalog=live thinking=off mode=act
[model] provider=anthropic model=claude-sonnet-4-6 catalog=bundled thinking=off mode=act
```

#### Supported Providers

| Provider | API Key Env Var | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | Default provider |
| `openai` | `OPENAI_API_KEY` | Use with `-p openai` |
| `openai-codex` | OAuth | OAuth-only; use `clite auth openai-codex`. Does not accept SDK custom tools; Codex built-in tools remain provider-native and are not executed through the local Cline tool registry. |
| `openrouter` | `OPENROUTER_API_KEY` | Use with `-p openrouter` |
| `vercel-ai-gateway` | `AI_GATEWAY_API_KEY` | Use with `-p vercel-ai-gateway` |
| `cline` | `CLINE_API_KEY` or OAuth | Cline-hosted; shows account/credit info on start |
| `oca` | OAuth | OAuth-only; use `clite auth oca` |

#### OAuth Authentication

For OAuth providers, normal CLI startup does not auto-trigger an OAuth flow. Run `clite auth <provider>` explicitly to authenticate in advance. If a non-interactive run selects an unauthenticated OAuth-backed provider, the CLI fails fast with an actionable error instead of hanging in a hidden auth bootstrap path. Tokens are persisted via `ProviderSettingsManager`.

---

### RPC Server

**Source:** `src/utils/session.ts` → `getCoreSessions()`, `createDefaultCliSessionManager()`

The CLI uses an RPC server (`@clinebot/rpc`) as its preferred session backend. On each run:

1. `ensureRpcRuntimeAddress()` verifies the configured address and can stop or replace an incompatible stale local server
2. `tryConnectRpcSessions()` checks if a healthy server is already listening
3. If not found, `startRpcServerInBackground()` spawns `clite rpc start` as a detached process
4. Retries up to 5 times (100ms apart) waiting for the server to bind
5. Falls back to `CoreSessionService` (local SQLite) if the RPC server cannot start

This architecture allows desktop clients to share the same session service as the CLI. The RPC address defaults to `127.0.0.1:4317` and can be overridden via `CLINE_RPC_ADDRESS`.

---

### Chat Command Registry

**Sources:** `src/utils/chat-commands.ts`, `src/utils/plugin-chat-commands.ts`, `src/runtime/interactive-welcome.ts`

The CLI chat surfaces use a class-based command host with a default singleton-style registry of built-in commands. Hosts can clone that registry and register additional workspace/runtime-specific commands before handling input.

Built-in chat commands include:

| Command | Description |
|---|---|
| `/reset` / `/new` | Start a fresh session or connector thread binding |
| `/whereami` | Describe the current session/thread routing context |
| `/tools` | Show or toggle tool availability |
| `/yolo` | Show or toggle auto-approval |
| `/cwd` | Show or change cwd/workspace root |
| `/schedule` | Create/list/trigger/delete schedules where supported |
| `/stop` | Stop the active connector bridge when supported |
| `/config` | Open the config browser view |
| `/settings` | Alias for `/config` |

Plugin bridge behavior:

- Workspace plugins are loaded through the existing extension/plugin loader path.
- The CLI runs extension `setup(api)` through `ContributionRegistry`.
- Registered extension commands are adapted into chat command host entries.
- Plugin command names are normalized to slash form, so `echo` becomes `/echo`.

### Runtime Slash Commands

**Sources:** `packages/core/src/runtime/commands.ts`, `src/runtime/prompt.ts`, `src/runtime/interactive-welcome.ts`

After chat-command handling, prompt preparation resolves runtime slash commands from the shared runtime command registry:

| Command | Description |
|---|---|
| `/<workflow-name>` | Execute a configured workflow |
| `/<skill-name>` | Expand a configured skill |

Runtime slash commands are loaded from the `UserInstructionConfigWatcher`, merged through one registry, and expanded before a turn is sent to the agent. If a workflow and skill share the same name, workflow resolution wins.

---

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | API key for Anthropic |
| `OPENAI_API_KEY` | API key for OpenAI |
| `OPENROUTER_API_KEY` | API key for OpenRouter |
| `AI_GATEWAY_API_KEY` | API key for Vercel AI Gateway |
| `CLINE_API_KEY` | API key for Cline provider |
| `CLINE_DATA_DIR` | Base data directory (sessions/settings/teams/hooks). Default: `~/.cline/data` |
| `CLINE_RPC_ADDRESS` | RPC server address. Default: `127.0.0.1:4317` |
| `CLINE_SANDBOX` | Set to `1` to force sandbox mode |
| `CLINE_SANDBOX_DATA_DIR` | Override sandbox state directory. Default: `/tmp/cline-sandbox` |
| `CLINE_SESSION_DATA_DIR` | Override session data directory |
| `CLINE_TEAM_DATA_DIR` | Override team persistence directory |
| `CLINE_PROVIDER_SETTINGS_PATH` | Override provider settings file path |
| `CLINE_HOOKS_LOG_PATH` | Override hook audit log path |
| `CLINE_LOG_ENABLED` | Set to `0` or `false` to disable runtime file logging |
| `CLINE_LOG_LEVEL` | Runtime log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`/`silent`) |
| `CLINE_LOG_PATH` | Runtime log file path. Default: `<CLINE_DATA_DIR>/logs/clite.log` |
| `CLINE_LOG_NAME` | Logger name for runtime log records |
| `CLINE_HOOK_AGENT_RESUME` | Set to `1` when resuming a session (set automatically) |
| `NODE_ENV` | Set to `development` to enable verbose dev output (iteration markers) |

---

## Configuration Object (`Config`)

The `Config` interface is the internal runtime configuration assembled from parsed args and environment variables. It extends `CoreSessionConfig` from `@clinebot/core/node`:

```typescript
interface Config extends Omit<CoreSessionConfig, "apiKey" | "mode"> {
  // Inherited from CoreSessionConfig (selected fields):
  providerId: string          // resolved provider
  modelId: string             // resolved model
  systemPrompt: string        // system prompt (default or custom)
  maxIterations?: number      // max agentic loop iterations (optional; unset is unbounded)
  enableSpawnAgent: boolean   // --spawn / --no-spawn
  enableAgentTeams: boolean   // --teams / --no-teams
  enableTools: boolean        // --tools / --no-tools
  cwd: string                 // working directory
  workspaceRoot?: string      // git root (resolved from cwd)
  teamName?: string           // --team-name

  // CLI-specific additions:
  apiKey: string              // resolved API key
  knownModels?: Record<string, ModelInfo>    // live model catalog (if --refresh-models)
  loggerConfig?: RpcChatRuntimeLoggerConfig  // pino logger config
  sandbox: boolean            // --sandbox
  sandboxDataDir?: string     // resolved sandbox data dir
  thinking: boolean           // --thinking
  missionLogIntervalSteps: number    // --mission-step-interval (default: 3)
  missionLogIntervalMs: number       // --mission-time-interval-ms (default: 120000)
  showUsage: boolean          // -u flag
  showTimings: boolean        // -t flag
  outputMode: "text" | "json" // --output / --json
  mode: "act" | "plan"        // --mode
  defaultToolAutoApprove: boolean          // --auto-approve-tools / --require-tool-approval
  toolPolicies: Record<string, ToolPolicy> // per-tool enable/approve overrides
}
```

---

## Internal Architecture

```
src/
├── index.ts                    # Thin entry point — installs flush guards, calls runCli()
├── main.ts                     # runCli() — arg parsing, subcommand dispatch, config assembly
├── events.ts                   # handleEvent() / handleTeamEvent() — stdout renderer
├── approval.ts                 # requestToolApproval(), askQuestionInTerminal()
├── help.ts                     # showHelp(), showVersion()
│
├── commands/
│   ├── hook.ts                 # runHookCommand(), runHookWorkerCommand() — CLI hook handlers
│   ├── doctor.ts               # runDoctorCommand() — local health / cleanup command
│   ├── rpc.ts                  # runRpcStartCommand(), runRpcStatusCommand(), etc.
│   ├── auth.ts                 # runAuthCommand(), OAuth helpers, parseAuthCommandArgs()
│   ├── list.ts                 # runListCommand(), runHistoryListCommand()
│   └── rpc-runtime/            # RPC runtime request handlers, event bridge, provider actions
│
├── runtime/
│   ├── run-agent.ts            # runAgent() — single-shot execution
│   ├── run-interactive.ts      # runInteractive() — Ink TUI session
│   ├── active-runtime.ts       # setActiveRuntimeAbort() / abortActiveRuntime()
│   ├── session-events.ts       # subscribeToAgentEvents()
│   ├── prompt.ts               # resolveSystemPrompt(), buildUserInputMessage()
│   ├── interactive-config.ts   # loadInteractiveConfigData()
│   └── interactive-welcome.ts  # resolveClineWelcomeLine(), listInteractiveSlashCommands()
│
├── tui/
│   ├── interactive-tui.ts      # InteractiveTui — Ink (React) TUI component
│   └── components/
│       └── WelcomeView.ts      # Welcome screen component
│
├── logging/
│   └── adapter.ts              # createCliLoggerAdapter() — pino logger bridge
│
└── utils/
    ├── helpers.ts              # parseArgs(), formatToolInput/Output(), appendHookAudit(),
    │                           # configureSandboxEnvironment(), resolveWorkspaceRoot(), etc.
    ├── session.ts              # createDefaultCliSessionManager(), listSessions(), deleteSession(),
    │                           # RPC connection management, stale runtime recovery, CliSessionManager interface
    ├── hooks.ts                # createRuntimeHooks() — local CLI persistent hook-worker wiring
    ├── output.ts               # writeln(), writeErr(), write(), emitJsonLine(), c (ANSI colors)
    ├── resume.ts               # loadInteractiveResumeMessages()
    └── types.ts                # Config, ParsedArgs, ActiveCliSession, SessionDbRow, etc.
```

**Data flow:**

```
stdin / argv
    │
    ▼
parseArgs()
    │
    ▼
runCli() ──────────────────────────────────────────────────────────────┐
    │                                                                   │
    ├─ "hook" / "hook-worker" ──► runHookCommand() / runHookWorkerCommand() │
    │                        appendHookAudit()                         │
    │                        sessions.upsertSubagentSessionFromHook()  │
    │                                                                   │
    ├─ "rpc" subcommand ──► runRpcStart/Status/Stop/Ensure/Register()  │
    │                                                                   │
    ├─ "auth" subcommand ──► runAuthCommand()                          │
    │                                                                   │
    ├─ "doctor" subcommand ──► runDoctorCommand()                      │
    │                                                                   │
    ├─ "list" subcommand ──► runListCommand() / runHistoryListCommand() │
    │                                                                   │
    ├─ "sessions" subcommand ──► listSessions() / deleteSession()      │
    │                                                                   │
    └─ agent run                                                        │
         │                                                              │
         ▼                                                              │
    createDefaultCliSessionManager()                                    │
         ├── tryConnectRpcSessions() ──────────────────────────────►───┤
         └── fallback: CoreSessionService (local SQLite)               │
         │                                                              │
         ▼                                                              │
    sessionManager.start() ──► session created in backend              │
         │                                                              │
         ▼                                                              │
    sessionManager.send(prompt)                                         │
         │                                                              │
         ├── events ──► handleEvent() / handleTeamEvent() ──► stdout   │
         ├── hooks ───► local CLI hook-worker or shared RPC hook service ─►──┘
         └── result ──► print usage/timings if requested
         │
         ▼
    sessionManager.stop() + sessionManager.dispose()
```

---

## Examples

```bash
# Quick question (no tools needed)
clite --no-tools "What is the capital of France?"

# Code review via pipe
cat src/index.ts | clite "Review this code for bugs and suggest improvements"

# Summarise a git diff
git diff HEAD~1 | clite "Write a concise commit message for this diff"

# Custom persona
clite -s "You are Shakespeare" "Write a sonnet about artificial intelligence"

# Use a specific model
clite -m claude-opus-4-5-20251101 "Explain the theory of relativity"

# Use OpenAI
clite -p openai -m gpt-4o "What are the best practices for TypeScript?"

# Use OpenRouter
clite -p openrouter -m anthropic/claude-3-5-sonnet "Hello"

# Show timing and token usage
clite -u -t "Explain quantum entanglement"

# Parseable JSON output (NDJSON)
clite --output json "Summarize key architecture decisions in this repo"

# JSON mode with stdin
cat package.json | clite --json "Extract dependency names only"

# Plan mode
clite --mode plan "Outline a refactor strategy for the authentication module"

# Interactive coding session
clite -i -s "You are an expert TypeScript developer. Help me refactor my code."

# Interactive session with teams enabled
clite -i --teams --team-name dev-team

# Resume a previous session
clite --session 1700000000000_abcde_cli

# Sandbox mode (isolated ~/.cline state)
clite --sandbox "Experiment with something risky"

# Single-shot with sub-agent spawning disabled
clite --no-spawn "Simple task, no delegation needed"

# Agent teams for complex multi-step work
clite --teams "Coordinate a team to: 1) audit the codebase, 2) write tests, 3) generate docs"

# Restore a previous team session
clite --teams --team-name my-team "Continue where we left off"

# Refresh live model catalog for this run
clite --refresh-models -p anthropic "List available models"

# Require approval only for shell commands
clite --tool-require-approval run_commands "Update dependencies and run tests"

# Authenticate with Cline (OAuth)
clite auth cline

# Quick API key setup
clite auth --provider anthropic --apikey sk-ant-xxx --modelid claude-sonnet-4-6

# Open config browser
clite config

# List recent session history
clite list history

# List available workflows in this project
clite list workflows

# List sessions (raw JSON)
clite sessions list

# Delete a session
clite sessions delete --session-id 1700000000000_abcde_cli

# Pipe a file for analysis
cat package.json | clite "What dependencies does this project use and what do they do?"
```

## Connectors on a VM

Cline connectors are a general feature for exposing a Cline runtime through external chat platforms while keeping tool execution inside a VM or server-side workspace. A connector maps each external conversation thread to a runtime session, so users can talk to the agent from chat while the agent reads files, runs commands, edits code, and posts results back into that same conversation.

Slack is a good example of this feature because it supports both direct messages and `@mentions` in channels, but the deployment model is broader than Slack itself.

### What Connectors Support

- external chat conversations bound to Cline runtime sessions
- per-thread or per-DM session reuse
- tool-enabled work inside the VM filesystem and process environment
- scheduled runs that can post replies back into the originating chat thread
- in-chat utility commands such as `/whereami` and `/schedule`
- plugin-defined chat commands bridged from extension `registerCommand(...)`
- workflow and skill slash commands resolved before connector turns are sent to the runtime

Connector command flow:

1. Incoming connector text is offered to the shared chat command host first.
2. Built-in chat commands and plugin-registered commands can reply immediately at the host layer.
3. If no host-level command matches, the connector resolves runtime slash commands (workflow/skill) and sends the expanded prompt to the runtime session.
4. Slack also supports native Slack slash-command webhooks, which are converted into connector threads and routed through the same pipeline.

### Deployment Model

A typical connector deployment on a VM has three parts:

1. a long-lived Cline RPC service
2. a long-lived connector process for the chat platform
3. a public HTTPS endpoint that forwards incoming webhooks to the connector

Example local services:

1. RPC server on `127.0.0.1:4317`
2. connector webhook server on `127.0.0.1:8787`
3. reverse proxy or tunnel forwarding `https://chat-agent.example.com` to `127.0.0.1:8787`

This keeps the runtime private to the VM while still allowing the chat platform to reach the webhook endpoint.

### Slack as an Example Connector

For a single-workspace Slack bot, configure the connector with:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
BASE_URL=https://chat-agent.example.com
```

Recommended Slack bot scopes:

- `app_mentions:read`
- `channels:history`
- `channels:read`
- `chat:write`
- `groups:history`
- `groups:read`
- `im:history`
- `im:read`
- `mpim:history`
- `mpim:read`
- `users:read`

Recommended event subscriptions:

- `app_mention`
- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`

Set both Slack request URLs to:

```text
https://chat-agent.example.com/api/webhooks/slack
```

In channels, users should `@mention` the bot. In DMs, users should send plain text directly.

### Step-by-Step VM Setup

#### 1. Start the RPC service

Run the Cline RPC service as a long-lived process so connector sessions can create and reuse runtime sessions.

Example:

```bash
bun apps/cli/src/index.ts rpc start --address 127.0.0.1:4317
```

#### 2. Choose a stable public HTTPS URL

The connector usually listens only on a local interface such as `127.0.0.1:8787`. The chat platform must reach it through a stable public HTTPS hostname.

Practical options:

- a reverse proxy on the VM
- a load balancer
- a named Cloudflare Tunnel

Use a stable hostname such as:

```text
https://chat-agent.example.com
```

Avoid temporary tunnel URLs for any setup where you do not want to keep reconfiguring webhook settings.

#### 3. Create a connector environment file

Store connector configuration in an env file loaded by `systemd`.

Example:

```bash
BASE_URL=https://chat-agent.example.com
CLINE_REPO_DIR=/srv/cline
CLINE_WORKSPACE_ROOT=/srv/workspaces/project-a
CLINE_CONNECTOR_HOST=127.0.0.1
CLINE_CONNECTOR_PORT=8787
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

Suggested location:

```text
/etc/cline/connector.env
```

#### 4. Run the connector as a service

Use `systemd` so the connector stays up after you disconnect from the VM.

Example service:

```ini
[Unit]
Description=Cline chat connector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=cline
EnvironmentFile=/etc/cline/connector.env
ExecStart=/bin/bash -lc 'cd "$CLINE_REPO_DIR" && /path/to/bun --conditions=development --cwd apps/cli ./src/index.ts connect slack -i --base-url "$BASE_URL" --enable-tools --cwd "$CLINE_WORKSPACE_ROOT" --host "${CLINE_CONNECTOR_HOST:-127.0.0.1}" --port "${CLINE_CONNECTOR_PORT:-8787}"'
Restart=always
RestartSec=5
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

Notes:

- use the absolute path to `bun`, because `systemd` often does not inherit the interactive shell `PATH`
- keep `CLINE_REPO_DIR` and `CLINE_WORKSPACE_ROOT` separate if the repo root and working directory differ
- replace `connect slack` with the relevant adapter command for the connector you are running

Install and start it:

```bash
sudo cp cline-connector.service /etc/systemd/system/cline-connector.service
sudo systemctl daemon-reload
sudo systemctl enable --now cline-connector.service
```

#### 5. Expose the connector publicly

Point the public hostname at the local connector port.

For a Cloudflare Tunnel, the high-level flow is:

1. create a named tunnel
2. route a stable DNS hostname such as `chat-agent.example.com`
3. configure ingress to `http://127.0.0.1:8787`
4. run the tunnel as a long-lived service

#### 6. Configure the platform webhook

For Slack, set:

- Events request URL: `https://chat-agent.example.com/api/webhooks/slack`
- Interactivity request URL: `https://chat-agent.example.com/api/webhooks/slack`

#### 7. Verify health before testing chat

Check the connector locally:

```bash
curl http://127.0.0.1:8787/health
```

Check the public URL:

```bash
curl https://chat-agent.example.com/health
```

Both should return:

```text
ok
```

When the connector is healthy, logs should show successful adapter initialization, the configured listen address, and the webhook URL.

### Scheduling Replies Back Into the Chat Thread

Connectors can attach delivery metadata to schedules so scheduled output is posted back into the same conversation.

Slack examples:

```text
/whereami
/schedule create "daily repo check" --cron "0 9 * * 1-5" --prompt "Summarize repo status and open risks"
/schedule list
```

`/whereami` is useful for debugging because it shows the current connector thread context and delivery target.

### Secrets for Commands Running Inside the VM

If the agent needs API keys or other secrets for scripts it runs inside the VM:

- put them in the service environment file
- do not place them in prompts or checked-in files
- let scripts read them from the process environment

Example:

```bash
GITHUB_TOKEN=...
MY_API_KEY=...
```

This makes secrets available to child processes started by the connector service without requiring them to be pasted into chat. It does not prevent the agent from printing them if it is explicitly told to dump environment variables, so pair this with approval or hook policies if your deployment needs stronger safeguards.

### Common Setup Failures

`/usr/bin/env: bun: No such file or directory`

- `systemd` could not find Bun
- fix by using the full Bun path in `ExecStart`

`signingSecret is required`

- the Slack signing secret is missing from the environment file

`Failed to start server. Is port 8787 in use?`

- another process is already bound to the connector port
- identify it with `ss -ltnp | grep 8787`
- either stop the old process or move the connector to another port and update the proxy or tunnel origin

Cloudflare `1033`

- the DNS record exists, but no healthy tunnel is serving the hostname
- verify the named tunnel is running and routing to the correct local port

Slack says the Events URL did not respond to the challenge

- the public webhook URL is wrong, or the connector or tunnel is not healthy
- verify both `/health` and `/api/webhooks/slack` on the public hostname

Bot does not respond in DMs

- make sure the app has `message.im`, `im:read`, and `im:history`
- in Slack DMs, users should send plain text rather than `@mention` syntax

### Operational Notes

- Multiple users can talk to the same connector concurrently across separate DMs and external threads.
- Messages within a single thread are serialized to preserve ordering.
- Different threads can run concurrently.
- Workspace isolation is not automatic. If multiple users operate on the same checkout at the same time, they can interfere unless you route them to separate workspaces or sandboxes.

---

*Generated from source: `src/index.ts`, `src/main.ts`, `src/events.ts`, `src/commands/hook.ts`, `src/commands/auth.ts`, `src/commands/list.ts`, `src/commands/rpc.ts`, `src/runtime/run-agent.ts`, `src/runtime/run-interactive.ts`, `src/utils/helpers.ts`, `src/utils/session.ts`, `src/utils/hooks.ts`, `src/utils/output.ts`, `src/utils/types.ts`, `src/help.ts`*
