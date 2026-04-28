# Cline SDK DOC

This document is the detailed API and behavior reference for this repository.

Use it when you need:

- exported package surfaces
- behavior notes
- lifecycle semantics
- integration entrypoints

For contributor onboarding, use [AGENTS.md](./AGENTS.md).
For system design and dependency direction, use [ARCHITECTURE.md](./ARCHITECTURE.md).

## `@clinebot/shared`

Primary role: shared contracts and reusable runtime infrastructure.

Important exported areas:

- shared schemas and common types
- prompt helpers
- path helpers under `@clinebot/shared/storage`
- hook contracts and `HookEngine`
- extension contracts and `ContributionRegistry`
- telemetry config contracts
- runtime build env helpers for debug-aware subprocess launches

Behavior notes:

- shared contracts should be reusable by multiple higher layers
- **`BasicLogger`** (`@clinebot/shared`) is the cross-package logging contract: required `debug` and `log`, optional `error`. Verbose diagnostics use `debug` (hosts typically gate on debug log level). Operational messages use `log`. Implementations may attach **`BasicLogMetadata`** (`sessionId`, `runId`, `providerId`, `toolName`, `durationMs`, optional `severity` on `log` for warning-style lines). Use **`noopBasicLogger`** when a complete no-op instance is required.
- path/search helpers define the default config discovery locations used elsewhere in the stack
- `resolveClineBuildEnv(...)` prefers `CLINE_BUILD_ENV`, falls back to `NODE_ENV`, and also treats `--conditions=development` as a development build
- SDK-owned `node`/`bun` subprocess launches add inspector endpoints plus `--enable-source-maps` in development builds unless those flags are already present
- By default those child-process inspector ports are ephemeral (`--inspect=127.0.0.1:0`) to avoid collisions; set `CLINE_DEBUG_PORT_BASE` to restore deterministic role-based ports when needed
- Top-level Bun hosts still need Bun inspector flags separately; for example launch `apps/cli/src/index.ts` directly with `bun --inspect-brk=6499 ...` for the CLI process
- The VS Code launch config uses `"type": "bun"` (requires `oven.bun-vscode`) so the Bun debug adapter handles source maps natively; attach configs use `ws://` URLs with `localRoot`/`remoteRoot` pointing to `${workspaceFolder}` so breakpoints resolve correctly in workspace packages such as `packages/core`

## `@clinebot/llms`

Primary role: provider/model runtime layer built around an internal gateway registry.

Important exported areas:

- provider settings/config helpers
- model catalog helpers
- handler creation
- provider manifests and runtime registry
- shared gateway/provider contracts re-exported from `@clinebot/shared`

Behavior notes:

- provider execution is organized around a gateway registry plus AI SDK-backed protocol families, not just provider ids
- app and runtime code should use the package root exports rather than deep internal imports

## `@clinebot/agents`

Primary role: stateless execution layer.

Important exported areas:

- `Agent`
- tool definitions/registry helpers
- runtime streaming helpers
- hook and extension typing

Behavior notes:

- one `Agent` instance supports one active run at a time
- `run(...)` starts a new conversation
- `continue(...)` appends to existing conversation state
- tool execution concurrency is bounded by `maxParallelToolCalls`
- hook and extension setup is deterministic and happens before active execution

### Extensions vs Hooks

- extensions register contributions such as tools, commands, message builders, renderers, and providers
- hooks intercept lifecycle stages and can influence execution

Use extensions for additive runtime surface.
Use hooks for lifecycle interception and policy.

### Turn Preparation

The agent runtime exposes a turn-preparation seam before each model call.

Behavior:

- `before_agent_start` hooks/extensions still run before the provider request
- hosts may also supply `prepareTurn` to rewrite message history or the system prompt before the turn is sent
- this is the primary seam for host-owned context pipelines such as compaction

## `@clinebot/core/hub`

Primary role: hub infrastructure, discovery, and host-side client access. Exposed as a subpath export of `@clinebot/core`; everything is also re-exported from the `@clinebot/core` root barrel.

Important exported areas:

- local hub discovery helpers (`resolveHubOwnerContext`, `resolveSharedHubOwnerContext`, `readHubDiscovery`, `writeHubDiscovery`, `clearHubDiscovery`, `probeHubServer`, `toHubHealthUrl`, `createHubServerUrl`, `withHubStartupLock`, `resolveHubBuildId`)
- endpoint defaults and env resolution (`resolveHubEndpointOptions`, `DEFAULT_HUB_HOST`, `DEFAULT_HUB_PORT`, `DEFAULT_HUB_PATHNAME`)
- hub WebSocket server (`startHubWebSocketServer`, `ensureHubWebSocketServer`, and the shared-owner wrappers `startHubServer`, `ensureHubServer`)
- detached daemon control (`spawnDetachedHubServer`, `ensureDetachedHubServer`, `prewarmDetachedHubServer`), plus the daemon process entry at `@clinebot/core/hub/daemon-entry`
- WebSocket hub clients (`NodeHubClient`, `connectToHub`, `resolveHubUrl`, `sendHubCommand`, `probeHubConnection`, `verifyHubConnection`, `normalizeHubWebSocketUrl`)
- high-level client adapters (`HubSessionClient`, `HubUIClient`)
- compatible-local-hub resolution used by `createRuntimeHost` (`resolveCompatibleLocalHubUrl`, `ensureCompatibleLocalHubUrl`)

Behavior notes:

- hub infrastructure, discovery, and client adapters live in a single module tree under `packages/core/src/hub/`.
- `HubSessionClient` and `HubUIClient` wrap `NodeHubClient` to provide session-lifecycle and UI-notification surfaces respectively.
- `ensureCompatibleLocalHubUrl` is the canonical entry point for "start the shared hub if it isn't already running"; it honors build-ID-aware discovery and uses `ensureDetachedHubServer` internally.

## `@clinebot/core`

Primary role: stateful orchestration over the stateless agent runtime.

Important exported areas:

- `ClineCore`
- `RuntimeHost`, `LocalRuntimeHost`, `HubRuntimeHost`, `RemoteRuntimeHost`, and `createRuntimeHost`
- runtime builder
- config watchers/loaders
- config-side watcher projection helpers
- default tools and tool routing
- provider settings management
- telemetry factories
- `TelemetryLoggerSink`: an `ITelemetryAdapter` that forwards capture/metric calls to a `BasicLogger` (distinct from host-specific logger bundles such as the CLI Pino wrapper).

### Telemetry and logging

- `TelemetryService` can accept a `BasicLogger`; when present, core installs a `TelemetryLoggerSink` so telemetry events are also written to that logger with structured fields (`telemetrySink`, `event`, `properties`, …).
- Host applications (for example the CLI) typically construct a logger bundle that includes both the native backend and a `BasicLogger` view: the CLI keeps the `pino` instance for transport concerns and passes `adapter.core` into SDK/runtime options.
- `ClineCore.create(...)` also accepts `logger?: BasicLogger` in `ClineCoreOptions`; core uses it for operational diagnostics such as RPC backend auto-start, reuse, and fallback decisions.

### Runtime Composition

Core composes the runtime from:

- provider config
- tools
- hooks
- extensions
- default context compaction policy
- user instruction watcher
- telemetry

Core’s internal extension layer is split by concern:

- `extensions/config`: watchers, parsers, config loaders, and slash-command projection helpers
- `extensions/plugin`: plugin loading and sandbox runtime
- `extensions/context`: context pipeline behavior such as compaction

### Session Behavior

Core owns:

- session lifecycle
- message persistence
- transcript and hook artifact persistence
- pending prompt queueing
- team/session persistence
- checkpoint hooks when `CLINE_CHECKPOINT=true`
- default context compaction injection for root sessions

Runtime boundary notes:

- `ClineCore.start(...)` is the ergonomic app-facing entrypoint and accepts the broad `CoreSessionConfig`
- `ClineCore.listHistory(...)` is the shared history listing entrypoint for app-facing history UIs. It hydrates display metadata and supports opt-in manifest fallback for callers that need to include legacy file-backed session rows.
- `ClineCore.list(...)` delegates to the hydrated history path for backward-compatible recent-session listing.
- `RuntimeHost` is the lower-level transport-safe execution contract used beneath `ClineCore`
- `LocalRuntimeHost` owns local in-process execution and local session persistence behavior
- `RpcRuntimeHost` owns RPC request translation, remote event adaptation, and remote lifecycle proxying
- host selection happens in `createRuntimeHost(...)`

### Context Compaction

Core provides a built-in default compaction policy for root sessions.

Behavior:

- core owns context compaction through its turn-preparation pipeline
- the default core pipeline supports two built-in strategies:
  - `agentic`: summarize older history with a model and roll summaries forward
  - `basic`: compact locally without calling a model
- built-in strategy dispatch is registry-based, so adding a new strategy is a file plus one registry entry
- compaction runs before the model request, not as an agent lifecycle hook after usage is recorded

Integration rule:

- if a host needs custom compaction behavior, prefer a core-owned prepare-turn pipeline
- do not rely on a public `AgentConfig.compaction` field

### Watcher Projections

Core exposes watcher-derived runtime helpers from the config layer rather than from `runtime/` wrappers.

Behavior:

- slash-command expansion for skills and workflows is provided by the generic runtime-command projection in `extensions/config`
- there are no separate `runtime/skills.ts` or `runtime/workflows.ts` wrapper layers
- rules formatting remains a runtime concern because it feeds prompt assembly

### Session Bootstrap

`ClineCore.create(...)` accepts an optional `prepare(input)` hook.

Use it when a higher-level integration needs to prepare workspace-scoped runtime
state before core starts a session, then attach the result through existing
generic seams.

`prepare(input)` runs on the broad `ClineCoreStartInput` before core normalizes
that input into the lower-level `RuntimeHost` contract. This means integrations
should mutate `input.config` directly for app-facing concerns such as
extensions, telemetry, or a generated session id.

The returned bootstrap can:

- transform the app-facing start input
- attach local runtime bootstrap state
- add extensions through `input.config.extensions`
- provide telemetry through `input.config.telemetry`
- register cleanup with `dispose()`

### Interactive Queueing

Turn requests support:

- `delivery: "queue"`
- `delivery: "steer"`

Behavior:

- queued turns are stored as pending prompts
- steer inserts at the front of the pending queue
- attachments are preserved
- interactive sessions automatically treat a new send as `delivery: "queue"` while a run is already in progress unless the caller explicitly requests another delivery mode
- core emits queue-related events and should be treated as the source of truth
- pending prompts can be listed, edited, steered, or removed through `pendingPrompts("list" | "update" | "delete", input)` before they are drained into a turn

### Telemetry

Core supports:

- basic telemetry service usage
- OpenTelemetry-backed telemetry factories (`createConfiguredTelemetryService`, `OpenTelemetryProvider` in `@clinebot/core/telemetry`)

The main integration pattern is:

1. construct a telemetry service (often via `createClineTelemetryServiceConfig` from `@clinebot/shared` or explicit `OpenTelemetryProviderOptions`)
2. pass it to the host or session config
3. flush/dispose it at the host boundary (`ITelemetryService.flush` / `dispose`, and `OpenTelemetryProvider.dispose` when using the OTel provider)

**Signals.** When OpenTelemetry is enabled, the provider registers:

- **Logs (events):** each `ITelemetryService.capture` / `captureRequired` becomes a log record whose body is the event name and whose attributes carry flattened properties (see `OpenTelemetryAdapter`).
- **Metrics:** counters, histograms, and observable gauges from `recordCounter`, `recordHistogram`, `recordGauge`.
- **Traces (optional):** set `tracesExporter` (for example `"console"` or `"otlp"`) on `OpenTelemetryProviderOptions`, or `OTEL_TRACES_EXPORTER` via `createClineTelemetryServiceConfig`. OTLP traces POST to `{otlpTracesEndpoint ?? otlpEndpoint}/v1/traces`. A global `TracerProvider` is registered so `trace.getTracer(...)` from `@opentelemetry/api` and integrations such as Langfuse (`@clinebot/llms`) can emit spans. End-to-end correlation across separate processes (CLI → RPC → worker) still requires your transport to propagate W3C `traceparent` / baggage; the SDK does not yet attach those headers automatically to RPC calls.

**Event catalog.** Structured product events are named in `packages/core/src/telemetry/core-events.ts` (`CORE_TELEMETRY_EVENTS` and the `capture*` helpers). Use that module as the source of truth for event strings and typical properties.

**Collector configuration.** Standard OpenTelemetry environment variables are read by `createClineTelemetryServiceConfig`, including `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_TRACES_EXPORTER`, `OTEL_METRIC_EXPORT_INTERVAL`, and `OTEL_TELEMETRY_ENABLED`. Point `OTEL_EXPORTER_OTLP_ENDPOINT` at an OTLP HTTP/JSON collector (for example OpenTelemetry Collector or a vendor endpoint); paths `/v1/logs`, `/v1/metrics`, and `/v1/traces` are appended automatically.

## `@clinebot/enterprise`

Status:

- internal-only workspace package
- excluded from root SDK build/version/publish flows

Primary role: enterprise integration layer above core.

Important exported areas:

- `createWorkosIdentityAdapter`
- `createWorkosControlPlaneAdapter`
- `EnterpriseAuthService`
- `EnterpriseSyncService`
- `prepareEnterpriseRuntime`
- `prepareEnterpriseCoreIntegration`
- `createEnterprisePlugin`
- file-backed enterprise stores and materializer implementations

### Core Contracts

- `IdentityAdapter`
- `EnterpriseControlPlane`
- `EnterpriseConfigBundle`
- `EnterpriseIdentityClaims`
- `EnterpriseAccessToken`
- `EnterpriseClaimsMapper`
- `EnterpriseTelemetryAdapter`

### Enterprise Sync Behavior

`prepareEnterpriseRuntime(...)` performs:

1. enterprise identity resolution
2. normalized bundle fetch
3. token/bundle caching
4. managed instruction materialization
5. claims-to-role mapping
6. telemetry normalization

Returned data includes:

- bundle
- identity
- claims
- roles
- telemetry config
- managed paths
- plugin definition

### Core Bridge Behavior

`prepareEnterpriseCoreIntegration(...)` is the preferred bridge into core.

It:

- prepares the enterprise runtime
- relies on core's default watcher to discover enterprise-managed instruction paths from `.cline/<plugin>/managed.json`
- optionally creates a telemetry service from enterprise telemetry settings
- returns `applyToStartSessionInput(...)` plus `dispose()` so callers can feed it into `ClineCore.create({ prepare })`

### Plugin Behavior

`createEnterprisePlugin(...)` returns a valid `AgentPlugin`.

Behavior:

- `setup(...)` is side-effect-only
- it can sync enterprise state and register provider contributions
- it should not be treated as the rich data-returning enterprise bootstrap API

### Managed Files

Enterprise-managed content is written under:

- `.cline/<plugin>/rules.md`
- `.cline/<plugin>/workflows/*.md`
- `.cline/<plugin>/skills/*/SKILL.md`
- `.cline/<plugin>/cache/bundle.json`
- `.cline/<plugin>/cache/token.json`
- `.cline/<plugin>/managed.json`

Those files are then consumed through the same watcher-based loading path as other user instruction files.

## `@clinebot/cli`

Primary role: executable reference host for the SDK stack.

Important areas:

- CLI argument parsing
- runtime/session assembly through core
- provider/model resolution
- interactive TUI
- connector bridges
- RPC server lifecycle commands

Behavior notes:

- supports single-shot, interactive, and piped input flows
- approval behavior varies by environment and tool policy
- chat commands and runtime slash commands are distinct systems

## Host Apps

### `@clinebot/code`

Desktop/Tauri host with a Next.js UI.

Notable behaviors:

- provider settings and model selection are driven by SDK packages rather than static app-local state
- settings surfaces for rules, MCP servers, and provider config map back to shared/core behavior

### `@clinebot/vscode`

VS Code extension host over RPC-backed chat/runtime interactions.

Notable behaviors:

- ensures RPC runtime
- streams chat/runtime events into the webview

## Reference Usage Pattern

If you are integrating the published SDK stack directly, the usual path is:

1. use `@clinebot/core` as the orchestration entrypoint
2. let core compose `@clinebot/agents` and `@clinebot/llms`
3. optionally use `@clinebot/rpc` when the runtime must be split across processes

If you are integrating enterprise-specific behavior inside this repo, the usual path is:

1. use `@clinebot/enterprise` to prepare enterprise state
2. bridge into core through `prepare`, watcher, extensions, and telemetry inputs
3. keep enterprise-specific logic out of the published core API surface

## CLI Features

### Hooks

Hooks are shell scripts (or any executable) that Cline runs automatically at key points in the agent lifecycle. They let you inspect, modify, or cancel agent actions without changing your prompts or source code. Hook files are discovered from `.cline/hooks/` in your project root and from any directory passed via `--hooks-dir`.

---

#### Creating a Hook

Name your hook file after the event it should handle and place it in `.cline/hooks/`. The file must be executable.

```
.cline/
└── hooks/
    ├── tool_call.sh
    ├── tool_result.sh
    └── agent_start.sh
```

**Example — log every tool call and allow it to proceed:**

```bash
#!/usr/bin/env bash
# .cline/hooks/tool_call.sh
input=$(cat)
echo "Tool called: $(echo "$input" | jq -r '.tool')" >&2
echo '{}'
```

Make it executable: `chmod +x .cline/hooks/tool_call.sh`

---

#### Supported Hook Events

| Event | Fires when… |
|---|---|
| `tool_call` | **Before** a tool executes. Output can modify or cancel the call. |
| `tool_result` | **After** a tool executes. Output can add context to the result. |
| `agent_start` | The agent session starts. |
| `agent_resume` | The agent resumes after a pause or review. |
| `agent_end` | The agent session ends normally. |
| `agent_abort` | The agent session is aborted. |
| `prompt_submit` | A prompt is submitted to the model. |
| `pre_compact` | Just before context compaction runs. |
| `session_shutdown` | The session is shutting down. |

---

#### Hook Output Fields

Return a JSON object from stdout. An empty `{}` means "do nothing."

| Field | Type | Effect |
|---|---|---|
| `cancel` | `boolean` | Cancels the pending tool call. |
| `review` | `boolean` | Pauses and prompts the user to review. |
| `context` | `string` | Injects context into the agent's next turn. |
| `contextModification` | `string` | Replaces or amends the context window content. |
| `errorMessage` | `string` | Surfaces an error message to the agent. |
| `overrideInput` | `any` | Replaces the tool's input before execution. |

**Example — cancel a destructive file write:**

```bash
#!/usr/bin/env bash
# .cline/hooks/tool_call.sh
input=$(cat)
tool=$(echo "$input" | jq -r '.tool')
if [ "$tool" = "write_file" ]; then
  echo '{"cancel": true, "errorMessage": "File writes are not allowed."}'
else
  echo '{}'
fi
```

---

#### CLI Usage

```bash
# List all registered hooks
clite list hooks

# Load hooks from an additional directory at runtime
clite --hooks-dir ./ci/hooks "run the test suite"
```

> **Note:** Hooks are disabled in `--yolo` mode. Pass `--verbose` to print each hook invocation as it fires.

---

### Plugins

Plugins extend Cline CLI with custom chat commands. Each plugin registers one or more `AgentPluginCommand` handlers that become available as slash commands across all connected chat surfaces. Plugins are loaded per-workspace and run in-process alongside the agent.

---

#### Installing a Plugin

Drop a `.js` or `.mjs` file into `.cline/plugins/` at your workspace root. Cline discovers modules automatically — no registration step required.

```
my-project/
└── .cline/
    └── plugins/
        └── my-plugin.js
```

```js
// .cline/plugins/my-plugin.js
export default [
  {
    name: "greet",
    description: "Say hello",
    handler: async (ctx) => "Hello from my plugin!",
  },
];
```

Once loaded, users can type `/greet` in any active connector (Telegram, Slack, etc.).

---

#### Listing Plugins

```bash
clite list plugins
clite list plugins --json
```

---

### Rules

Rules are named instruction sets automatically injected into the agent's system prompt at the start of every session. They encode persistent conventions — coding style, tool preferences, project constraints — without repeating them in every prompt. Rules apply to all run modes, including headless and yolo runs.

---

#### File Locations

| Scope | Path |
|---|---|
| Workspace-local | `.cline/rules/*.md` |
| Global (user) | `~/Documents/Cline/Rules/*.md` |
| Global (data dir) | `~/.cline/data/settings/rules/*.md` |
| AGENTS.md convention | `AGENTS.md` at the repository root (auto-loaded as a rule) |

Files with `disabled: true` in their YAML frontmatter are skipped.

---

#### Rule File Format

```markdown
---
name: typescript-style
---

Always prefer TypeScript. Never use the `any` type.
Imports must use ES module syntax (`import`/`export`).
```

The `name` field is optional — the file name is used if omitted.

---

#### Listing Rules and Hot-Reloading

```bash
clite list rules
clite list rules --json
```

Rule files are **watched for changes** while a session is running. Edits take effect on the next agent turn — no restart required.

---

### Skills and Workflows

Skills and workflows extend Cline's behavior through plain Markdown files with a YAML frontmatter header.

- **Skills** inject reusable capabilities into the system prompt, shaping *how* Cline behaves across all tasks.
- **Workflows** are named procedures invoked on demand as slash commands (e.g., `/deploy`), telling Cline *what to do* when triggered.

---

#### File Locations

| Type | Search Paths |
|---|---|
| Skills | `.cline/skills/` (project), `~/Documents/Cline/Skills/` (global) |
| Workflows | `.cline/workflows/` (project) |

Files with `disabled: true` in frontmatter are ignored.

---

#### File Format

**Skill:**

```markdown
---
name: test-runner
---
Run tests with `bun test`. Always show the full output.
```

**Workflow:**

```markdown
---
name: deploy
---
Run the full deployment pipeline: lint, test, build, then push.
```

---

#### Invoking Workflows

**Interactive CLI (TUI):** Type `/` in the message composer to open the workflow picker. Use arrow keys to navigate, then **Enter** or **Tab** to insert.

**Connector mode (Telegram, Slack, etc.):** Send the workflow as a slash command in chat:

```
/deploy
/review
```

---

#### Listing Skills and Workflows

```bash
clite list skills
clite list workflows
```

---

### Scheduled Agents

Schedules let the agent run a prompt autonomously on a cron pattern. There are two entry points: the `/schedule` chat command (when using a connector) and the `clite schedule` CLI subcommand.

---

#### 1. Via Chat (Connectors — Slack, Telegram, Discord, etc.)

When connected via a chat connector, type `/schedule` commands directly in the thread. The connector dispatches the command using your current thread's context (workspace, provider, model) and ties delivery back to that same thread.

| Command | Description |
|---|---|
| `/schedule` or `/schedule help` | Show usage |
| `/schedule create "<name>" --cron "<pattern>" --prompt "<text>"` | Create a recurring schedule |
| `/schedule list` | List schedules targeting this thread |
| `/schedule trigger <schedule-id>` | Trigger a schedule immediately |
| `/schedule delete <schedule-id>` | Delete a schedule |

**Example:**

```
/schedule create "Daily standup" --cron "0 9 * * MON-FRI" --prompt "Summarize open PRs and blockers."
```

The agent replies with the schedule ID, cron pattern, and next run time.

---

#### 2. Via the CLI (`clite schedule`)

Manage schedules from the terminal using `clite schedule` subcommands. The CLI communicates with the `clite` RPC sidecar, starting it automatically if needed.

**Required flags for `create`:** `--cron`, `--prompt`, `--workspace`.

```bash
# Create a schedule
clite schedule create "Daily code review" \
  --cron "0 9 * * MON-FRI" \
  --prompt "Review PRs opened yesterday and summarize issues." \
  --workspace /path/to/repo \
  --provider cline \
  --model openai/gpt-5.3-codex \
  --timeout 3600 \
  --max-iterations 50 \
  --tags automation,review

# Route results to a chat thread (use /whereami in Telegram to get the thread ID)
clite schedule create "Daily summary" \
  --cron "0 9 * * *" \
  --prompt "Summarize yesterday's activity in this workspace." \
  --workspace /path/to/repo \
  --delivery-adapter telegram \
  --delivery-bot my_bot \
  --delivery-thread telegram:123456789

# Update a schedule
clite schedule update <schedule-id> --cron "0 10 * * MON-FRI" --enabled

# Inspect and manage
clite schedule list
clite schedule list --enabled --tags automation
clite schedule get <schedule-id>
clite schedule trigger <schedule-id>
clite schedule pause <schedule-id>
clite schedule resume <schedule-id>
clite schedule delete <schedule-id>

# Execution history and stats
clite schedule history <schedule-id> --limit 20
clite schedule stats <schedule-id>
clite schedule active
clite schedule upcoming --limit 10

# Export and import (YAML by default; use --json for JSON)
clite schedule export <schedule-id> > daily-review.yaml
clite schedule import ./daily-review.yaml
```

**`schedule update` flags:** `--cron`, `--prompt`, `--name`, `--model`, `--provider`, `--workspace`, `--cwd`, `--mode <act|plan>`, `--system-prompt`, `--timeout`, `--max-iterations`, `--tags`, `--enabled`/`--disabled`, `--pause`/`--resume`, delivery options, autonomous options.

**Delivery options** (on `create` and `update`): `--delivery-adapter`, `--delivery-bot`, `--delivery-channel`, `--delivery-thread`.

**Autonomous options** (on `create` and `update`): `--autonomous`/`--no-autonomous`, `--idle-timeout <seconds>`, `--poll-interval <seconds>`.

---

#### How It Works

1. **RPC-backed persistence.** All commands talk to the `clite` RPC sidecar (`127.0.0.1:25463` by default, overridable via `--address` or `CLINE_RPC_ADDRESS`). The sidecar starts automatically if not running.
2. **Cron patterns** use standard five-field cron syntax (e.g., `"0 9 * * MON-FRI"` = 9 am Mon–Fri).
3. **Three required fields** for `create`: a name, a `--cron` pattern, and a `--prompt`.
4. **Delivery metadata.** When a schedule is created from a chat thread, the adapter and thread ID are stored automatically. Use `--delivery-*` flags to set this explicitly from the CLI.
5. **Autonomous mode.** Pass `--autonomous` to keep the agent alive between cron firings, controlled by `--idle-timeout` and `--poll-interval`.
6. **Export format** is YAML by default; pass `--json` or use a `.json` extension to export as JSON. `import` accepts both formats.

---

### Agent Team

The agent team runtime gives Cline the ability to spawn and coordinate multiple sub-agents within a single run. Use it for tasks that benefit from parallelism or specialization — such as planning, implementation, and verification happening concurrently. Team tools are enabled by default and can be disabled with `--no-teams`.

---

#### Available Team Tools

**Teammate Management:**

| Tool | Description |
|---|---|
| `team_spawn_teammate` | Spawn a new teammate agent with a given agentId and rolePrompt. Only the lead agent can spawn. |
| `team_shutdown_teammate` | Shut down a running teammate by agentId. Only the lead agent can manage teammates. |
| `team_status` | Return a snapshot of team members, task counts, mailbox, and mission log stats. |

**Task Delegation:**

| Tool | Description |
|---|---|
| `team_run_task` | Route a delegated task to a teammate. Choose sync (wait for result) or async (run in background). Sync mode only allows one call per agent per turn. |
| `team_list_runs` | List teammate runs started with team_run_task in async mode, including live activity/progress fields. |
| `team_await_runs` | Wait for async teammate runs. Provide runId to wait for one specific run, or omit it to wait for all active async runs. Uses a long timeout (1 hour). |
| `team_cancel_run` | Cancel one async teammate run by runId. |

**Task Board:**

| Tool | Description |
|---|---|
| `team_task` | Manage shared team tasks with action-specific payloads. Actions: create (requires title and description, optional dependsOn and assignee), list (optional status and assignee filters), claim (mark task in_progress), complete (finish task with summary), block (mark as blocked with reason). |

**Communication:**

| Tool | Description |
|---|---|
| `team_send_message` | Send a mailbox message to a specific teammate with optional subject, body, and taskId. |
| `team_broadcast` | Broadcast a message to all teammates with optional subject, body, and taskId. |
| `team_read_mailbox` | Read the current agent's mailbox, with optional unreadOnly filter and automatic mark-as-read. |

**Mission Log:**

| Tool | Description |
|---|---|
| `team_mission_log` | Append a mission log update with kind (progress, handoff, blocked, decision, done, error), summary, optional evidence array, and nextAction. |

**Outcomes:**

| Tool | Description |
|---|---|
| `team_create_outcome` | Create a converged team outcome document with a title and optional requiredSections array (defaults to current_state, boundary_analysis, interface_proposal). |
| `team_attach_outcome_fragment` | Attach a content fragment to an outcome section with optional sourceRunId. |
| `team_review_outcome_fragment` | Review (approve/reject) one outcome fragment. |
| `team_finalize_outcome` | Finalize a completed outcome. |
| `team_list_outcomes` | List all team outcomes. |

**Cleanup:**

| Tool | Description |
|---|---|
| `team_cleanup` | Clean up the team runtime. Only the lead agent can run cleanup. Fails if teammates are still running. |

---

#### Named Team State (Persistent Workflows)

Pass `--team-name <name>` to persist team state across multiple CLI invocations. State is stored under `CLINE_TEAM_DATA_DIR` (defaults to `~/.cline/data/teams/<name>/`) and includes the task board, mailbox, mission log, and spawn/run records.

On subsequent runs with the same name, the prior state is restored automatically and the agent receives a `team_restored` event — allowing multi-day workflows to resume where they left off.

```bash
# Start a named team workflow
clite --team-name sprint "Plan and implement the auth module"

# Resume the same team on the next day
clite --team-name sprint "Continue — pick up any incomplete tasks"
```

---

#### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--teams` / `--no-teams` | enabled | Enable or disable agent team tools |
| `--team-name <name>` | — | Persist and restore team state under this name |
| `--mission-step-interval <n>` | `3` | Steps between automatic mission log updates |
| `--mission-time-interval-ms <ms>` | `120000` | Milliseconds between automatic mission log updates |

> **Note:** Team tools are automatically disabled in `--yolo` mode.

---

#### Examples

```bash
# Team tools are on by default — no flag needed
clite "Plan, implement, and verify the release checklist"

# Named persistent team
clite --team-name my-team "Plan, implement, and verify the release checklist"
clite --team-name my-team "Continue yesterday's team workflow"

# Disable team tools entirely
clite --no-teams "Answer from general knowledge only"

# Emit structured JSON events including team lifecycle and progress
clite --json --team-name my-team "Run the full release workflow"
```

---

### Sub Agent

Sub-agents allow the CLI agent to delegate discrete subtasks to autonomous child agents that run independently within their own session. Each spawned sub-agent has access to all tools enabled in the parent session and executes its assigned task to completion before the parent resumes. This enables complex, multi-step workflows to be broken down and handled in parallel or sequentially without the parent agent losing context.

---

#### How It Works

The parent agent invokes the `spawn_agent` tool, passing a task description and any relevant context. The spawned sub-agent runs with its own session ID (tracked as a child of the parent session), executes the task using all enabled tools, and returns a result. The parent agent blocks until the sub-agent completes. All tool calls, events, and completions within the sub-agent are recorded in its own transcript for audit purposes. When spawning is enabled, sub-agents themselves also receive the `spawn_agent` tool, allowing recursive delegation.

---

#### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--spawn` | `true` | Enable the `spawn_agent` tool |
| `--no-spawn` | — | Disable sub-agent spawning |
| `--enable-spawn` | — | Force-enable `spawn_agent`, overriding `--no-spawn` |

---

#### Behavior in Yolo Mode

In `--yolo` mode, sub-agent spawning is **disabled by default**. To enable it, pass `--spawn` explicitly alongside `--yolo`. Use `--enable-spawn` to override a prior `--no-spawn` in any mode.

---

#### Example

```bash
# Default: spawn_agent enabled — agent may delegate subtasks automatically
clite "Audit the codebase and fix all lint errors"

# Disable sub-agent spawning for a focused, single-agent task
clite --no-spawn "Fix this specific function"

# Yolo mode with spawning explicitly re-enabled
clite --yolo --spawn "Refactor the entire auth module"
```

---

### Connectors

Connectors bridge external messaging platforms into Cline CLI RPC sessions, letting you interact with an AI agent through Telegram, Slack, Google Chat, WhatsApp, or Linear without leaving those tools. Each connector runs as a persistent background process (or foreground with `-i`) and maps platform messages to the same RPC chat model used by `clite`.

---

#### Available Connectors

| Connector | Platform | Transport |
|-----------|----------|-----------|
| `telegram` | Telegram Bot | Polling |
| `slack` | Slack | Webhook |
| `gchat` | Google Chat | Webhook |
| `whatsapp` | WhatsApp | Webhook |
| `linear` | Linear | Webhook |

---

#### Telegram

Telegram uses long-polling — no public URL required. Register a bot via [@BotFather](https://t.me/BotFather) to get a token.

```bash
# Background (default)
clite connect telegram -m <bot_username> -k <bot_token>

# Foreground (logs in active terminal)
clite connect telegram -i -m <bot_username> -k <bot_token>
```

Credentials can also be set via environment variables:

```bash
export TELEGRAM_BOT_USERNAME=my_bot
export TELEGRAM_BOT_TOKEN=123456:ABC-xyz
clite connect telegram
```

> **Note:** Tool use is enabled by default for Telegram sessions. Disable with `--no-tools`.

| Flag | Description |
|------|-------------|
| `-m`, `--bot-username` | Telegram bot username |
| `-k`, `--bot-token` | Telegram bot token |
| `--provider` | AI provider override |
| `--model` | Model name override |
| `--api-key` | Provider API key override |
| `--system` | System prompt override |
| `--cwd` | Working directory for the session |
| `--mode` | Agent mode (`act` or `plan`) |
| `--max-iterations` | Max agent iterations per message |
| `--no-tools` | Disable tool use (on by default) |
| `--hook-command` | Shell command for lifecycle events |
| `--rpc-address` | Custom RPC server address |
| `-i` | Run in foreground |

---

#### Google Chat

Configure your Google Chat App to send events to `<base-url>/api/webhooks/gchat`.

```bash
# Background
clite connect gchat --base-url https://your-domain.com

# Foreground on a custom port
clite connect gchat -i --base-url https://your-domain.com --port 8787

# With Pub/Sub for Workspace Events
clite connect gchat --base-url https://your-domain.com \
  --pubsub-topic projects/my-project/topics/my-topic
```

---

#### WhatsApp

Point your Meta webhook URL to `<base-url>/api/webhooks/whatsapp`.

```bash
# Background
clite connect whatsapp --base-url https://your-domain.com

# Foreground on a custom port
clite connect whatsapp -i --base-url https://your-domain.com --port 8787
```

| Flag | Description |
|------|-------------|
| `--base-url` | Public base URL of this server |
| `--port` | Local port to bind |
| `--phone-number-id` | WhatsApp phone number ID |
| `--access-token` | Meta access token |
| `--app-secret` | Meta app secret (for request verification) |
| `--verify-token` | Webhook verification token |

---

#### Slack and Linear

```bash
clite connect slack --base-url https://your-domain.com
clite connect linear --base-url https://your-domain.com
```

Run `clite connect slack --help` or `clite connect linear --help` for the full flag list.

---

#### Shared Chat Commands

These slash commands work in any connector conversation:

| Command | Description |
|---------|-------------|
| `/clear` or `/new` | Start a fresh session |
| `/abort` | Abort the current running task |
| `/exit` | Stop the connector process |
| `/whereami` | Print the current delivery thread ID |
| `/tools [on\|off\|toggle]` | Enable, disable, or toggle tool use |
| `/yolo [on\|off\|toggle]` | Enable, disable, or toggle auto-approve mode |
| `/cwd <path>` | Change the agent's working directory |
| `/schedule create\|list\|trigger\|delete` | Manage scheduled deliveries |

---

#### Stopping Connectors

```bash
# Stop all running connectors
clite connect --stop

# Stop a specific connector
clite connect --stop telegram
clite connect --stop gchat
```

---

#### Hook Command

Pass `--hook-command` to run a shell script on connector lifecycle events.

```bash
clite connect telegram -m my_bot -k TOKEN --hook-command '/path/to/hook.sh'
```

| Event | Fired when |
|-------|------------|
| `message.received` | A new message arrives from the platform |
| `message.completed` | The agent successfully responds |
| `message.failed` | The agent fails to respond |
| `connector.stopping` | The connector is shutting down |
| `schedule.delivery.started` | A scheduled delivery begins |
| `schedule.delivery.sent` | A scheduled delivery is sent successfully |
| `schedule.delivery.failed` | A scheduled delivery fails |

---

## File-Based And Event-Driven Automation (`.cline/cron/`)

Operators can author automation tasks as Markdown files inside a
global `~/.cline/cron/` directory by default, or a configured workspace
`.cline/cron/` directory. `ClineCore` exposes the public automation API
through `cline.automation`; internally core parses these files, stores spec
state in its own `cron.db`, materializes runs, executes them through the
runtime, and writes per-run reports.

### File layout

- `.cline/cron/*.md` — **one-off** task specs.
- `.cline/cron/*.cron.md` — **recurring** task specs (standard 5-field cron pattern).
- `.cline/cron/events/*.event.md` — **event-driven** task specs.
- `.cline/cron/reports/<run-id>.md` — generated reports. Derived artifact; do not edit by hand.
- `.cline/data/db/cron.db` — durable cron state. Never edit by hand; sessions live in a separate `sessions.db`.

### Frontmatter

Use YAML frontmatter delimited by `---` lines. The Markdown body is used as
the task prompt when frontmatter `prompt` is omitted.

Common fields:

| Field | Required | Notes |
|---|---|---|
| `id` | no | Stable external id. Falls back to normalized relative path. |
| `title` | no | Defaults to `id`, then to filename stem. |
| `prompt` | no | If omitted, the markdown body is used. One of the two is required. |
| `workspaceRoot` | **yes** | Absolute path for the session. |
| `mode` | no | `yolo` (default), `act`, or `plan`. |
| `tools` | no | Comma-separated string or string array of allowed tools. Omitted defaults to all tools; `[]` disables work tools. |
| `systemPrompt` | no | Override system prompt. Rules and notes metadata are appended. |
| `modelSelection` | no | `{ providerId, modelId }`. |
| `maxIterations` | no | Positive integer. |
| `timeoutSeconds` | no | Positive integer. Aborts the run on expiry. |
| `notesDirectory` | no | Absolute directory path injected into the system prompt for durable automation notes. |
| `extensions` | no | String array containing any of `rules`, `skills`, `plugins`. Omitted defaults to all; `[]` disables config extensions. |
| `source` | no | Session source string. Defaults to `user`. |
| `tags` | no | String array. |
| `enabled` | no | Defaults to `true`. |
| `metadata` | no | Arbitrary object. |

Recurring-only fields (`*.cron.md`): `schedule` (required), `timezone`.

Event-only fields (`events/*.event.md`): `event` (required), `filters`,
`debounceSeconds`, `dedupeWindowSeconds`, `cooldownSeconds`, `maxParallel`.

Event filters match fields on the normalized automation event envelope. Filter
keys first look in `attributes`, then `payload`, then top-level envelope fields
such as `source`, `subject`, `workspaceRoot`, and `dedupeKey`. Dot paths are
supported, so `pullRequest.baseBranch: main` matches
`attributes.pullRequest.baseBranch`.

Supported `tools` values are the default tool names: `read_files`,
`search_codebase`, `run_commands`, `fetch_web_content`, `apply_patch`,
`editor`, `skills`, `ask_question`, `submit_and_exit`. In `yolo` mode, the
completion tool `submit_and_exit` remains enabled even when `tools` narrows the
work tools.

Unknown trigger-specific fields on the wrong file kind mark the spec
invalid; they are recorded with `parse_status='invalid'` but never run.
`cwd` is not part of file-based cron specs; cron sessions use
`workspaceRoot` as their working directory.

### Example cron job file

Recurring spec example:

```md
---
id: daily-code-review
title: Daily Code Review
workspaceRoot: /absolute/path/to/repo
schedule: "0 9 * * MON-FRI"
tools: run_commands,read_files
mode: act
enabled: true
modelSelection:
  providerId: openai
  modelId: gpt-5.4
timeoutSeconds: 1800
systemPrompt: You are a precise automation agent that reports only actionable review findings.
maxIterations: 20
tags:
  - automation
  - review
metadata:
  owner: platform
notesDirectory: /absolute/path/to/notes
extensions:
  - rules
  - skills
  - plugins
source: user
---
Review the open pull requests, identify the highest-risk changes, run the
relevant checks if needed, and write a concise summary of findings.
```

Save recurring specs as `.cline/cron/<name>.cron.md`. For a one-off task,
use `.cline/cron/<name>.md` and omit the `schedule` field.

A copyable example is also available at
[`apps/examples/cron/daily-code-review.cron.md`](./apps/examples/cron/daily-code-review.cron.md).

Event-driven spec example:

```md
---
id: pr-review
title: Review new PRs
workspaceRoot: /absolute/path/to/repo
event: github.pull_request.opened
filters:
  repository: acme/api
  pullRequest:
    baseBranch: main
debounceSeconds: 30
dedupeWindowSeconds: 600
cooldownSeconds: 120
maxParallel: 2
tags:
  - github
  - review
---
Review the opened pull request, summarize risks, and recommend follow-up work.
```

Save event specs as `.cline/cron/events/<name>.event.md`. A copyable
event-driven example is available at
[`apps/examples/cron/events/pr-review.event.md`](./apps/examples/cron/events/pr-review.event.md).
For a local test that does not need GitHub or any webhook receiver, use
[`apps/examples/cron/events/local-manual-test.event.md`](./apps/examples/cron/events/local-manual-test.event.md).

### Event-driven flow

Event type strings such as `github.pull_request.opened` are conventions, not a
built-in global registry. A spec file subscribes to a normalized event type, and
an adapter fires that event after translating a native source payload.

1. **Register interest with a spec file** — create
   `.cline/cron/events/pr-review.event.md` with
   `event: github.pull_request.opened`. On startup or watcher reconcile,
   automation stores the spec in `cron_specs.event_type`.
2. **Receive a source-specific event** — for GitHub, a GitHub App, webhook
   receiver, connector, plugin, or host integration receives the raw pull
   request webhook payload.
3. **Normalize before ingress** — the adapter translates the source payload into
   an `AutomationEventEnvelope` and calls `cline.automation.ingestEvent(...)`
   or the hub `cron.event.ingest` command.
4. **Match and enqueue** — `CronEventIngress` records the event, matches event
   specs by type and filters, applies dedupe/debounce/cooldown policy, and
   queues matching `cron_runs`.
5. **Run and report** — `CronRunner` executes the queued event run and injects
   trigger event context into the prompt. Reports include trigger event
   frontmatter and a `## Trigger Event` section.

### Lifecycle

- **Startup reconciliation** — the hub walks `.cline/cron/`, parses every
  file, and upserts the result. Invalid specs are recorded with
  `parse_error`; they never run until fixed.
- **Watcher** — `.cline/cron/` is watched recursively. Each create/change/
  delete triggers a debounced (~250ms) re-reconcile of the affected file.
- **Meaningful change detection** — whitespace-only body edits don't bump
  revisions. Changes to prompt, workspace, mode, model, system prompt,
  `tools`, `notesDirectory`, `extensions`, `source`, `schedule`/`timezone`,
  `event`/`filters`/throttling, or enabling a previously-disabled spec
  increment `revision`.
- **One-off runs** — at most one queued|running|done run exists per
  `(spec_id, revision)`. Editing a one-off in a meaningful way bumps its
  revision and materializes a new run.
- **Recurring runs** — `getNextCronTime` computes timezone-aware
  `next_run_at`. One overdue run is enqueued on startup (no unbounded
  backfill), then the scheduler advances to the next slot.
- **Event runs** — normalized events are recorded in `cron_event_log`, matched
  against valid enabled event specs, and queued with `trigger_kind='event'`.
  Dedupe, debounce, cooldown, and max-parallel policy are enforced before
  execution.
- **Deletions** — removing a file marks the spec as `removed=1`, disables
  it, and cancels any queued runs. Historical `done`/`failed` runs stay
  queryable.

### Reports

Each completed or failed run writes
`.cline/cron/reports/<run-id>.md`. The file includes YAML frontmatter
(`runId`, `specId`, `externalId`, `title`, `triggerKind`, `status`,
`sessionId`, `sourcePath`, `startedAt`, `completedAt`) and body sections
for summary, usage (token counts + cost), and a tool-call bullet list. Event
runs also include trigger event frontmatter plus a `## Trigger Event` section.

### Programmatic access

`HubWebSocketServer` accepts optional `cronOptions` that enable the
`CronService`:

```ts
new HubWebSocketServer({
  runtimeHandlers: ...,
  cronOptions: { workspaceRoot: "/absolute/workspace" },
});
```

The service exposes `listSpecs`, `getSpec`, `listRuns`, `getRun`,
`listActiveRuns`, `listUpcomingRuns`, `ingestEvent`, `listEventLogs`,
`getEventLog`, and `reconcileNow()` for hub-side query and ingress APIs.
SDK callers should prefer `cline.automation`: `start`, `stop`,
`reconcileNow`, `ingestEvent`, `listEvents`, `getEvent`, `listSpecs`, and
`listRuns`. Tests cover the parser (`@clinebot/core`
`src/cron/specs/cron-spec-parser.test.ts`), store, reconciler, materializer,
and runner.

### Test Plan

Drop one-off specs into `.cline/cron/*.md`, recurring specs into `.cline/cron/*.cron.md`, event specs into `.cline/cron/events/*.event.md`, create `ClineCore` with automation enabled or run the hub, and see runs materialized, executed, and reported to `.cline/cron/reports/<run-id>.md` — all backed by `.cline/data/db/cron.db`.
