# Cline SDK Documentation

This document is the API and behavior reference for the Cline SDK workspace. It
describes the current package surfaces, runtime features, host entrypoints, and
file formats.

For contributor workflow and repository setup, see [CONTRIBUTING.md](./CONTRIBUTING.md).
For architecture and package boundaries, see [ARCHITECTURE.md](./ARCHITECTURE.md).
For development routing rules, see [AGENTS.md](./AGENTS.md).

## Package Map

| Package | Role |
|---|---|
| `@clinebot/shared` | Shared contracts, schemas, prompt helpers, path helpers, hooks, extension registry, telemetry config, automation types, and low-level utilities. |
| `@clinebot/llms` | Provider/model runtime, model catalogs, provider registration, handler creation, and gateway contracts. |
| `@clinebot/agents` | Stateless agent loop, model/tool orchestration, lifecycle hooks, streaming events, and standalone runtime factories. |
| `@clinebot/core` | Stateful orchestration, sessions, runtime hosts, hub integration, config watching, plugin loading, default tools, automation, settings, storage, and telemetry. |
| `@clinebot/enterprise` | Internal enterprise layer for identity, control-plane sync, managed instruction materialization, claims mapping, and telemetry. |
| `@clinebot/cli` | Executable reference host for local, interactive, scheduled, connector, and ACP workflows. |

## `@clinebot/shared`

`@clinebot/shared` is the low-level contract package used by the SDK packages and
host apps.

### Exports

Primary exports from the package root include:

- agent and runtime contracts
- message, tool, provider, model, and gateway types
- hook contracts and hook payload schemas
- extension contracts and `ContributionRegistry`
- connector event contracts
- prompt formatting helpers
- remote config schemas
- telemetry contracts and telemetry config helpers
- `BasicLogger`, `BasicLogMetadata`, and `noopBasicLogger`
- JSON, shell, string, date, and Zod helpers
- hub, RPC, workspace, and chat contracts

Subpath exports:

- `@clinebot/shared/browser` for browser-safe shared exports
- `@clinebot/shared/types` for shared type contracts
- `@clinebot/shared/storage` for Cline directory and storage path helpers
- `@clinebot/shared/db` for shared database helpers
- `@clinebot/shared/automation` for automation frontmatter and automation spec types

### Logging

`BasicLogger` is the cross-package logging contract. It requires `debug` and
`log`, with optional `error`. Use `debug` for verbose diagnostics and `log` for
operational messages.

`BasicLogMetadata` supports structured fields such as `sessionId`, `runId`,
`providerId`, `toolName`, `durationMs`, and optional `severity` for warning-style
log lines. Use `noopBasicLogger` when a complete no-op logger is needed.

### Build Environment Helpers

`resolveClineBuildEnv(...)` prefers `CLINE_BUILD_ENV`, falls back to `NODE_ENV`,
and treats `--conditions=development` as a development build.

SDK-owned `node` and `bun` subprocess launches add source maps and inspector
flags in development builds unless those flags are already present. Inspector
ports are ephemeral by default (`--inspect=127.0.0.1:0`) to avoid collisions. Set
`CLINE_DEBUG_PORT_BASE` when deterministic role-based ports are needed.

Top-level Bun hosts still need Bun inspector flags on the host process itself,
for example:

```sh
bun --inspect-brk=6499 apps/cli/src/index.ts
```

## `@clinebot/llms`

`@clinebot/llms` owns provider configuration, model catalogs, provider
registration, handler construction, and gateway-backed model execution.

### Exports

Primary exports include:

- provider and model catalog helpers: `getAllProviders`, `getProvider`,
  `getProviderIds`, `getModelsForProvider`, `getGeneratedProviderModels`,
  `getGeneratedModelsForProvider`, `registerProvider`, `registerModel`,
  `unregisterProvider`, `resetRegistry`
- handler helpers: `createHandler`, `createHandlerAsync`, `registerHandler`,
  `registerAsyncHandler`
- provider id utilities: `BUILT_IN_PROVIDER`, `BUILT_IN_PROVIDER_IDS`,
  `isBuiltInProviderId`, `normalizeProviderId`
- gateway helpers: `createGateway`, `DefaultGateway`
- shared message, tool, content, provider, and model types
- Langfuse telemetry cleanup: `disposeLangfuseTelemetry`

The browser entrypoint is available at `@clinebot/llms/browser`.

### Provider Runtime

Provider execution is organized around a gateway registry and protocol families.
Callers should use root exports instead of importing internal provider modules.

The gateway accepts one or more provider configs and creates agent-compatible
model adapters:

```ts
import { createGateway } from "@clinebot/llms";

const gateway = createGateway({
  providerConfigs: [{ providerId: "openai", apiKey: process.env.OPENAI_API_KEY }],
});

const model = gateway.createAgentModel({
  providerId: "openai",
  modelId: "gpt-5.4",
});
```

## `@clinebot/agents`

`@clinebot/agents` provides the stateless agent loop. It can run standalone or be
composed by `@clinebot/core`.

### Exports

Primary exports include:

- `AgentRuntime` and `Agent`
- `createAgentRuntime` and `createAgent`
- `AgentRuntimeConfig`, `AgentRuntimeConfigWithModel`, and
  `AgentRuntimeConfigWithProvider`
- `AgentRunInput` and `AgentEventListener`
- shared runtime types re-exported from `@clinebot/shared`
- `createTool` for authoring tools

### Runtime Construction

Standalone callers can supply either a pre-built model or provider/model IDs.

```ts
import { Agent, createTool } from "@clinebot/agents";

const echo = createTool<{ text: string }, string>({
  name: "echo",
  description: "Echo text back to the model.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  execute: async (input) => input.text,
});

const agent = new Agent({
  providerId: "openai",
  modelId: "gpt-5.4",
  apiKey: process.env.OPENAI_API_KEY,
  systemPrompt: "You are a concise coding assistant.",
  tools: [echo],
});

const result = await agent.run("Say hello through the echo tool.");
```

### Execution Model

- `run(input)` starts a run from the supplied input and current runtime state.
- `continue(input?)` appends optional input and continues from the current
  conversation state.
- `restore(messages)` replaces the conversation state while preserving the model,
  tools, hooks, plugins, and subscribers.
- `abort(reason?)` aborts the active run.
- `subscribe(listener)` receives runtime events and returns an unsubscribe
  callback.
- `toolExecution` controls sequential or parallel tool execution. The runtime
  defaults to sequential execution.
- Tool policies can auto-approve, require approval, or block tools by name.

### Hooks and Turn Preparation

Agent hooks can observe and influence lifecycle stages such as run start, model
calls, tool calls, and run completion. `prepareTurn` can rewrite messages or the
system prompt before each model call and is the primary entrypoint for
host-owned context pipelines.

## `@clinebot/core`

`@clinebot/core` is the main SDK entrypoint for stateful applications. It
combines provider settings, tools, hooks, extensions, sessions, storage,
telemetry, settings, automation, and runtime-host selection.

### Exports

Important root exports include:

- `ClineCore`
- runtime hosts: `RuntimeHost`, `LocalRuntimeHost`, `HubRuntimeHost`,
  `RemoteRuntimeHost`, `createRuntimeHost`
- runtime capabilities: `RuntimeCapabilities`, `normalizeRuntimeCapabilities`
- default tools: `createBuiltinTools`, `createDefaultTools`,
  `createDefaultToolsWithPreset`, `createDefaultExecutors`, `DefaultToolNames`,
  `ALL_DEFAULT_TOOL_NAMES`, `ToolPresets`
- config services: rule, skill, workflow, and user-instruction loaders/watchers
- plugin loading helpers
- MCP loading and tool creation helpers
- session services, snapshots, checkpoint restore, history, and storage
- settings APIs: `CoreSettingsService`, `createCoreSettingsService`
- provider settings, provider catalog, OAuth, and account helpers
- telemetry services and event helpers
- automation API types
- `Agent` and `createAgentRuntime` from `@clinebot/agents`
- `Llms` namespace export for `@clinebot/llms`

Subpath exports:

- `@clinebot/core/hub` for hub clients, servers, daemon helpers, discovery, and
  hub transport utilities
- `@clinebot/core/hub/daemon-entry` for the detached hub daemon entrypoint
- `@clinebot/core/telemetry` for OpenTelemetry adapter/provider exports

### Creating Core

```ts
import { ClineCore } from "@clinebot/core";

const cline = await ClineCore.create({
  clientName: "my-app",
  backendMode: "auto",
  logger,
  telemetry,
});

const started = await cline.start({
  prompt: "Inspect this repository and summarize the test setup.",
  config: {
    providerId: "cline",
    modelId: "openai/gpt-5.3-codex",
    systemPrompt: "You are a precise coding assistant.",
    workspaceRoot: process.cwd(),
    cwd: process.cwd(),
    enableTools: true,
    enableSpawnAgent: true,
    enableAgentTeams: true,
  },
});
```

`ClineCore.create(...)` accepts:

- `clientName` and `distinctId` for client identity
- `backendMode: "auto" | "local" | "hub" | "remote"`
- `hub` and `remote` connection options
- `capabilities` for app-owned tool executors and approval UI
- `telemetry` and `logger`
- `toolPolicies`
- `messagesArtifactUploader`
- `automation`
- `fetch` for local provider HTTP customization
- `prepare(input)` for workspace-scoped session bootstrap

### Runtime Hosts

Core can execute through four host modes:

- `auto`: prefer a compatible local hub when available, otherwise use the local
  runtime.
- `local`: run in-process with local storage.
- `hub`: require a compatible local websocket hub.
- `remote`: require an explicit remote websocket hub endpoint.

`RuntimeHost` is the transport boundary beneath `ClineCore`. It exposes
transport-safe methods such as `startSession`, `runTurn`, `restoreSession`,
`abort`, `stopSession`, `getSession`, `listSessions`, `deleteSession`,
`updateSession`, `readSessionMessages`, `dispatchHookEvent`, and `subscribe`.

App integrations should prefer `ClineCore` methods (`start`, `send`, `restore`,
`get`, `list`, `listHistory`, `stop`, `delete`, `readMessages`,
`ingestHookEvent`) unless they are implementing a runtime host.

### Runtime Capabilities

`RuntimeCapabilities` let host apps implement interactive behavior once and use
it across local, hub, and remote sessions.

```ts
const cline = await ClineCore.create({
  backendMode: "hub",
  capabilities: {
    toolExecutors: {
      askQuestion: async (question, options, context) => {
        return appUi.askQuestion({ question, options, context });
      },
    },
    requestToolApproval: async (request) => {
      return appUi.requestToolApproval(request);
    },
  },
});
```

Local mode invokes capability handlers directly. Hub and remote modes advertise
capability names to the hub, receive targeted capability and approval requests,
call the same handlers in the owning client, and respond through the hub
protocol. The client that creates or restores a runtime session owns the
client-local capabilities for that session.

Long-running capability prompts receive a `ToolContext.abortSignal`. If a run is
aborted, the owning client disconnects, or the hub shuts down while a capability
request is pending, the in-process handler is aborted.

### Sessions

Core owns:

- session lifecycle
- message persistence
- transcript and hook artifact persistence
- pending prompt queueing
- team/session persistence
- checkpoint restore and fork coordination
- default context compaction for root sessions

`ClineCore.start(...)` is the ergonomic app-facing entrypoint and accepts
`ClineCoreStartInput`, whose `config` field is a `CoreSessionConfig`.

`CoreSessionConfig` includes:

- model selection: `providerId`, `modelId`, `apiKey`, `baseUrl`, headers,
  provider config, known models, thinking, and reasoning effort
- runtime behavior: tools, spawn-agent support, team support, MCP settings tools,
  yolo flag, max iterations, timeout, execution settings, and tool routing rules
- workspace and prompt config: `workspaceRoot`, `cwd`, `systemPrompt`,
  `workspaceMetadata`, images, files, and initial messages
- local runtime hooks: hooks, logger, telemetry, extension context, extra tools,
  extensions, and team callbacks
- context features: compaction, checkpointing, skills allowlist, and mistake
  limits

### History and Snapshots

`ClineCore.listHistory(...)` is the shared history listing entrypoint for
app-facing history UIs. It hydrates display metadata and supports manifest
fallback when requested by the caller. `ClineCore.list(...)` delegates to the
same history path for recent-session listing.

`CoreSessionSnapshot` is the canonical cross-transport session projection. It
combines the current session record with optional messages, accumulated usage,
checkpoint metadata, workspace/model details, lineage, and app metadata. Use
this shape for session-detail UIs and cross-transport session state work.

Checkpoint restore and fork behavior is coordinated through
`SessionVersioningService`. It validates the source session and checkpoint run
count, plans message/workspace restoration, delegates materialization to the
active transport adapter, retains checkpoint refs, and returns canonical
snapshots when available.

### Pending Prompts

Turn requests support:

- `delivery: "queue"` to append to the pending prompt queue
- `delivery: "steer"` to insert at the front of the queue

Interactive sessions automatically queue a send while a run is active unless the
caller requests another delivery mode. Attachments are preserved.

Pending prompts can be inspected and edited through:

- `cline.pendingPrompts.list({ sessionId })`
- `cline.pendingPrompts.update({ sessionId, promptId, prompt, delivery })`
- `cline.pendingPrompts.delete({ sessionId, promptId })`

### Context Compaction

Core provides default context compaction through the turn-preparation pipeline.

Built-in strategies:

- `basic`: compact locally without a model call
- `agentic`: summarize earlier history with a model and roll summaries forward

Compaction runs before the model request. Hosts that need custom compaction
should supply core-level compaction behavior through `CoreSessionConfig` or the
prepare-turn pipeline.

### Settings

`ClineCore.settings` and `CoreSettingsService` expose settings listing and
mutation.

User global settings are persisted at `settings/global-settings.json` under the
Cline data directory, or at `CLINE_GLOBAL_SETTINGS_PATH` when that override is
set. `@clinebot/core` exports `GlobalSettingsSchema` as the Zod source of truth
for this file. Unknown fields are ignored on read/write so newer settings files
do not invalidate known privacy or tool settings. The current schema contains:

- `telemetryOptOut: boolean` (defaults to `false`)
- `disabledTools?: string[]`
- `disabledPlugins?: string[]`

The schema trims, deduplicates, sorts, and omits empty lists. When
`telemetryOptOut` is `true`, core returns an inert telemetry service and does
not start the configured telemetry provider. Hosts that change this setting
should call `setTelemetryOptOutGlobally(true, { telemetry })` with the current
telemetry service so core records the required `user.opt_out` confirmation event
before future telemetry is disabled.

**Event catalog.** Structured product events are named in `packages/core/src/services/telemetry/core-events.ts` (`CORE_TELEMETRY_EVENTS` and the `capture*` helpers). Use that module as the source of truth for event strings and typical properties.

**`task.completed` semantics.** `task.completed` marks the moment the
assistant declared the task done, not the moment the SDK session record
was finalized. The local runtime emits it when it observes a successful
`submit_and_exit` tool call in an `AgentResult` — the SDK's analog of
original Cline's `attempt_completion`. For non-interactive runs that
finish without invoking the explicit completion tool (for example when
the configured tools do not include the yolo preset), the same event is
emitted from `shutdownSession` as a fallback. Each session is guaranteed
at most one `task.completed` emission. The payload includes an optional
`source: "submit_and_exit" | "shutdown"` field so dashboards can
differentiate parity-driven emissions from lifecycle-driven fallbacks.

**Activation funnel.** The startup activation/workspace events emitted by
hosts and the local-runtime bootstrap (`user.extension_activated`,
`workspace.initialized`, `workspace.init_error`, `workspace.path_resolved`)
are defined alongside their `capture*` helpers in
`packages/core/src/services/telemetry/core-events.ts`. They are emitted via
the normal `ITelemetryService.capture(...)` path so the user's telemetry
opt-out setting is honored — they are *not* `captureRequired` events.

Host integration rules:

- Hosts must call the configured telemetry singleton via the CLI/VS Code
  helpers (`captureCliExtensionActivated`, `captureExtensionActivated`)
  rather than constructing their own services.
- The CLI must apply `setClineDir(...)` and `setHomeDir(...)` from
  `@clinebot/shared/storage` **before** calling
  `captureCliExtensionActivated()` so the persisted distinct-id and any
  other on-disk telemetry state lands under a user-supplied
  `--config <dir>` rather than the default `~/.cline` location.
- Hosts that spawn a detached `@clinebot/core/hub/daemon-entry` process
  should forward enough metadata into the daemon argv for it to
  reconstruct an equivalent telemetry service. The reference VS Code
  daemon (`apps/vscode/src/hub-daemon.ts`) shows the expected shape.

Hub-backed runtimes expose the same mutation path through `settings.list` and
`settings.toggle`. Successful mutations return an updated settings snapshot and
publish `settings.changed` with the changed setting types.

Skill enabled state is stored in skill Markdown frontmatter:

- disabling a skill writes or updates `disabled: true`
- enabling a skill removes frontmatter fields that disable the skill
- Markdown body content and unrelated frontmatter fields are preserved

Host UIs should call the settings API instead of writing skill files directly.

### Default Tools

Core default tool names are:

- `read_files`
- `search_codebase`
- `run_commands`
- `fetch_web_content`
- `apply_patch`
- `editor`
- `skills`
- `ask_question`
- `submit_and_exit`

Use `createBuiltinTools`, `createDefaultTools`, or
`createDefaultToolsWithPreset` to construct the tool set for a runtime. Tool
policies control auto-approval and blocking by tool name.

### Hooks

Hook files are executable scripts discovered from hook search paths such as
`.cline/hooks/` and the global hook directory. They receive JSON payloads on
stdin and return a JSON control object on stdout.

Supported hook events:

| Event | Description |
|---|---|
| `agent_start` | Session execution starts. |
| `agent_resume` | A session resumes. |
| `agent_abort` | A session is aborted. |
| `agent_end` | Session execution completes. |
| `agent_error` | Session execution fails. |
| `tool_call` | A tool call is about to execute. |
| `tool_result` | A tool call has completed. |
| `prompt_submit` | A user prompt is submitted. |
| `pre_compact` | Context compaction is about to run. |
| `session_shutdown` | The session is shutting down. |

Hook output supports:

| Field | Effect |
|---|---|
| `cancel` | Cancels the pending operation. |
| `review` | Requests user review. |
| `context` | Adds context for the next turn. |
| `contextModification` | Replaces or adjusts context content. |
| `errorMessage` | Surfaces an error message. |
| `overrideInput` | Replaces a tool input before execution. |
| `systemPrompt` | Adjusts the system prompt for supported hook stages. |
| `appendMessages` | Adds messages for supported hook stages. |

### Rules, Skills, and Workflows

Core loads user instruction files through unified config watchers. Files are
watched while sessions are running and updates apply on the next turn.

Rules are persistent instructions injected into the system prompt.

| Scope | Path |
|---|---|
| Workspace | `.cline/rules/*.md` |
| Global documents | `~/Documents/Cline/Rules/*.md` |
| Global data dir | `~/.cline/data/settings/rules/*.md` |
| Repository convention | `AGENTS.md` at the repository root |

Skills are reusable behavior instructions. Workflows are named procedures
available as slash commands.

| Type | Search paths |
|---|---|
| Skills | `.cline/skills/`, `~/Documents/Cline/Skills/` |
| Workflows | `.cline/workflows/` |

Files with `disabled: true` in YAML frontmatter are ignored.

Example rule:

```md
---
name: typescript-style
---

Prefer TypeScript. Use ES module imports and exports.
```

Example skill:

```md
---
name: test-runner
---

Run tests with `bun test` and report failures with file paths.
```

Example workflow:

```md
---
name: release-check
---

Run lint, typecheck, tests, and build, then summarize blockers.
```

### Plugins

Plugins register additive runtime contributions such as tools, commands, message
builders, renderers, providers, rules, and automation event types.

Core exposes helpers to discover and load plugin modules:

- `resolveAgentPluginPaths`
- `discoverPluginModulePaths`
- `loadAgentPluginFromPath`
- `loadAgentPluginsFromPaths`
- `loadAgentPluginsFromPathsWithDiagnostics`
- `resolveAndLoadAgentPlugins`

Plugin setup receives extension context and can register contributions through
the extension registry. Use plugins for additive runtime surface and hooks for
lifecycle interception.

### MCP

Core can load MCP settings, register MCP servers, and expose MCP tools through
the runtime.

Important helpers include:

- `resolveDefaultMcpSettingsPath`
- `loadMcpSettingsFile`
- `registerMcpServersFromSettingsFile`
- `createMcpTools`
- `createDisabledMcpToolPolicy`
- `createDisabledMcpToolPolicies`
- `InMemoryMcpManager`

`disableMcpSettingsTools` in `CoreSessionConfig` skips tools from MCP settings
for that session.

### Telemetry

Core supports no-op telemetry, basic telemetry service usage, and
OpenTelemetry-backed telemetry through `@clinebot/core/telemetry`.

Main exports:

- `TelemetryService`
- `TelemetryLoggerSink`
- `createConfiguredTelemetryService`
- `createOpenTelemetryTelemetryService`
- `OpenTelemetryProvider`
- `OpenTelemetryAdapter`
- structured core event helpers from `core-events`

When a `BasicLogger` is supplied to `TelemetryService`, core installs
`TelemetryLoggerSink` so telemetry events are also written to the logger with
structured fields such as `telemetrySink`, `event`, and `properties`.

OpenTelemetry support includes:

- logs for `capture` and `captureRequired`
- metrics for counters, histograms, and gauges
- optional traces through `tracesExporter` or `OTEL_TRACES_EXPORTER`

`createClineTelemetryServiceConfig` reads standard OpenTelemetry environment
variables such as `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
`OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_TRACES_EXPORTER`,
`OTEL_METRIC_EXPORT_INTERVAL`, and `OTEL_TELEMETRY_ENABLED`.

## `@clinebot/core/hub`

The hub is the shared websocket runtime for local multi-client and remote-style
execution. It is exported through `@clinebot/core/hub` and re-exported from
`@clinebot/core`.

### Exports

Important exports include:

- discovery helpers: `resolveHubOwnerContext`, `resolveSharedHubOwnerContext`,
  `readHubDiscovery`, `writeHubDiscovery`, `clearHubDiscovery`,
  `probeHubServer`, `toHubHealthUrl`, `createHubServerUrl`,
  `withHubStartupLock`, `resolveHubBuildId`
- endpoint defaults: `resolveHubEndpointOptions`, `DEFAULT_HUB_HOST`,
  `DEFAULT_HUB_PORT`, `DEFAULT_HUB_PATHNAME`
- server helpers: `startHubWebSocketServer`, `ensureHubWebSocketServer`,
  `startHubServer`, `ensureHubServer`
- detached daemon helpers: `spawnDetachedHubServer`, `ensureDetachedHubServer`,
  `prewarmDetachedHubServer`
- clients: `NodeHubClient`, `connectToHub`, `resolveHubUrl`,
  `sendHubCommand`, `probeHubConnection`, `verifyHubConnection`,
  `normalizeHubWebSocketUrl`
- adapters: `HubSessionClient`, `HubUIClient`
- hub schedule services: `HubScheduleService`, `HubScheduleCommandService`
- browser websocket, command transport, and native transport utilities

### Module Layout

Hub code is organized by role:

- `protocol/` for protocol contracts
- `client/` for websocket clients
- `server/` for server-side transport and handlers
- `daemon/` for detached process lifecycle
- `discovery/` for endpoint resolution and discovery files
- `transport/` and runtime-host modules for `RuntimeHost` adapters
- `shared/` for pure cross-role helpers

`ensureCompatibleLocalHubUrl` is the canonical entrypoint for finding or
starting a compatible shared local hub.

## Automation

Core automation is exposed through `ClineCore.create({ automation })` and the
`cline.automation` API. It supports one-off file tasks, recurring cron tasks,
and event-driven tasks.

```ts
const cline = await ClineCore.create({
  automation: {
    workspaceRoot: "/absolute/path/to/repo",
    cronScope: "workspace",
  },
});

await cline.automation.reconcileNow();
const specs = cline.automation.listSpecs({ parseStatus: "valid" });
```

### API

`cline.automation` exposes:

- `start()`
- `stop()`
- `reconcileNow()`
- `ingestEvent(event)`
- `listEvents(options?)`
- `getEvent(eventId)`
- `listSpecs(options?)`
- `listRuns(options?)`

Automation is enabled with `automation: true` or an options object. Options
include `cronSpecsDir`, `cronScope`, `workspaceRoot`, `dbPath`,
`pollIntervalMs`, `claimLeaseSeconds`, `globalMaxConcurrency`,
`watcherDebounceMs`, and `autoStart`.

### File Layout

Automation files live under a global, user, or workspace `.cline/cron/`
directory depending on configuration.

| Path | Purpose |
|---|---|
| `.cline/cron/*.md` | One-off task specs. |
| `.cline/cron/*.cron.md` | Recurring task specs using standard five-field cron patterns. |
| `.cline/cron/events/*.event.md` | Event-driven task specs. |
| `.cline/cron/reports/<run-id>.md` | Generated run reports. |
| `.cline/data/db/cron.db` | Durable automation state. |

Generated reports and `cron.db` are derived artifacts and should not be edited
by hand.

### Frontmatter

Common fields:

| Field | Required | Notes |
|---|---|---|
| `id` | no | Stable external id. Defaults to normalized relative path. |
| `title` | no | Defaults to `id`, then filename stem. |
| `prompt` | no | If omitted, the Markdown body is used. One of `prompt` or body content is required. |
| `workspaceRoot` | yes | Absolute path for the session. |
| `mode` | no | `yolo`, `act`, or `plan`. |
| `tools` | no | Comma-separated string or string array of allowed default tools. |
| `systemPrompt` | no | System prompt override. |
| `modelSelection` | no | `{ providerId, modelId }`. |
| `maxIterations` | no | Positive integer. |
| `timeoutSeconds` | no | Positive integer. |
| `notesDirectory` | no | Absolute directory injected into the prompt for durable notes. |
| `extensions` | no | String array containing `rules`, `skills`, and/or `plugins`. |
| `source` | no | Session source string. Defaults to `user`. |
| `tags` | no | String array. |
| `enabled` | no | Defaults to `true`. |
| `metadata` | no | Arbitrary object. |

Recurring-only fields for `*.cron.md`:

- `schedule` (required)
- `timezone`

Event-only fields for `events/*.event.md`:

- `event` (required)
- `filters`
- `debounceSeconds`
- `dedupeWindowSeconds`
- `cooldownSeconds`
- `maxParallel`

Event filters match fields on the normalized automation event envelope. Filter
keys first look in `attributes`, then `payload`, then top-level envelope fields
such as `source`, `subject`, `workspaceRoot`, and `dedupeKey`. Dot paths are
supported.

Supported `tools` values are the default tool names listed in the Default Tools
section. In `yolo` mode, `submit_and_exit` remains enabled as the completion
tool even when `tools` narrows the work tools.

Trigger-specific fields must match the file kind. For example, `schedule`
belongs in `*.cron.md`, and `event` belongs in `events/*.event.md`.

### Recurring Task Example

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
  providerId: cline
  modelId: openai/gpt-5.3-codex
timeoutSeconds: 1800
systemPrompt: You are a precise automation agent that reports actionable findings.
maxIterations: 20
tags:
  - automation
  - review
notesDirectory: /absolute/path/to/notes
extensions:
  - rules
  - skills
  - plugins
source: user
---

Review the open pull requests, identify the highest-risk changes, run relevant
checks if needed, and write a concise summary of findings.
```

### Event Task Example

```md
---
id: pr-review
title: Review PRs
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

### Event Flow

1. A spec file subscribes to a normalized event type such as
   `github.pull_request.opened`.
2. A source adapter receives a native event from a webhook, connector, plugin, or
   host integration.
3. The adapter normalizes the source payload into an `AutomationEventEnvelope`.
4. The adapter calls `cline.automation.ingestEvent(...)` or the hub
   `cron.event.ingest` command.
5. `CronEventIngress` records the event, matches specs by type and filters, and
   applies dedupe, debounce, cooldown, and max-parallel policy.
6. Matching runs are queued and executed by `CronRunner`.
7. Each completed or failed run writes a report under `.cline/cron/reports/`.

### Lifecycle

- Startup reconciliation parses automation specs and records valid and invalid
  specs.
- The watcher monitors `.cline/cron/` recursively and reconciles changed files
  after a debounce window.
- Meaningful changes increment the spec revision and may materialize a run.
- One-off specs materialize one run per `(spec_id, revision)`.
- Recurring specs compute timezone-aware `next_run_at` and enqueue one overdue
  run on startup.
- Event specs queue runs from normalized event ingress.
- Removing a spec disables it, marks it as removed, and cancels queued runs.

## `@clinebot/enterprise`

`@clinebot/enterprise` is an internal workspace package that composes with core
without adding enterprise-specific dependencies to published core APIs.

### Exports

Important exports include:

- WorkOS provider adapters
- identity contracts and adapters
- control-plane contracts and adapters
- enterprise auth and sync services
- managed instruction materializers
- runtime preparation helpers
- enterprise plugin creation helpers
- storage and telemetry helpers

### Runtime Preparation

`prepareEnterpriseRuntime(...)` performs:

1. identity resolution
2. normalized bundle fetch
3. token and bundle caching
4. managed instruction materialization
5. claims-to-role mapping
6. telemetry normalization

Returned data includes the bundle, identity, claims, roles, telemetry config,
managed paths, and plugin definition.

`prepareEnterpriseCoreIntegration(...)` prepares enterprise state and returns
`applyToStartSessionInput(...)` plus `dispose()` so callers can feed it into
`ClineCore.create({ prepare })`.

### Managed Files

Enterprise-managed content is written under:

- `.cline/<plugin>/rules.md`
- `.cline/<plugin>/workflows/*.md`
- `.cline/<plugin>/skills/*/SKILL.md`
- `.cline/<plugin>/cache/bundle.json`
- `.cline/<plugin>/cache/token.json`
- `.cline/<plugin>/managed.json`

Those files are consumed through the same watcher-based loading path as other
instruction files.

## `@clinebot/cli`

`@clinebot/cli` provides the `clite` executable and acts as the reference host
for the SDK stack.

### Main Flows

`clite` supports:

- single-prompt runs
- interactive TUI sessions with `--tui`
- session resume with `--id`
- JSON output for non-interactive prompt runs with `--json`
- plan mode with `--plan`
- background hub dispatch with `--zen`
- ACP mode with `--acp`
- provider authentication through `clite auth`
- history listing, update, delete, and HTML export
- config, MCP, doctor, schedule, hub, connector, update, version, and kanban
  commands

Common root options:

| Option | Description |
|---|---|
| `-p, --plan` | Run in plan mode. |
| `--json` | Emit JSON for non-interactive prompt runs. |
| `--auto-approve <boolean>` | Set default tool auto-approval. |
| `-c, --cwd <path>` | Working directory. |
| `--thinking <level>` | `none`, `low`, `medium`, `high`, or `xhigh`. |
| `-i, --tui` | Open the interactive terminal UI. |
| `--id <session-id>` | Resume an existing session. |
| `-P, --provider <id>` | Provider id. |
| `-k, --key <api-key>` | API key override for the run. |
| `-m, --model <model-id>` | Model id for the selected provider. |
| `-s, --system <system-prompt>` | System prompt override. |
| `-z, --zen` | Dispatch the run to the background hub. |
| `--retries [value]` | Maximum consecutive mistakes before exit. |
| `-t, --timeout <seconds>` | Optional run timeout. |
| `--acp` | Run Agent Client Protocol mode. |
| `--config <path>` | Configuration directory. |
| `--data-dir <path>` | Isolated local state directory. |
| `--hooks-dir <path>` | Additional hook directory. |
| `--update` | Check for updates and install when available. |
| `-v, --verbose` | Show verbose output. |

### Auth

```sh
clite auth cline
clite auth openai --apikey "$OPENAI_API_KEY" --modelid gpt-5.4
clite auth openai-compatible --baseurl http://localhost:8000/v1 --apikey local
```

### History

```sh
clite history --limit 50
clite history --json
clite history update --session-id <id> --title "New title"
clite history delete --session-id <id>
clite history export <sessionId> --output session.html
```

### Config Listing

The `config` command exposes discovered rules, skills, workflows, hooks,
plugins, MCP servers, tools, and related configuration views.

```sh
clite config
clite config --json
```

### Hooks in the CLI

Use `--hooks-dir` to add a hook directory for a run:

```sh
clite --hooks-dir ./ci/hooks "run the test suite"
```

The `hook` subcommand handles a hook payload from stdin and is used by hook
execution plumbing.

### Scheduled Tasks

The `schedule` command manages durable schedules through the local hub. It starts
or connects to the scheduler hub as needed.

Required flags for `schedule create` are `--cron`, `--prompt`, and
`--workspace`.

```sh
clite schedule create "Daily code review" \
  --cron "0 9 * * MON-FRI" \
  --prompt "Review PRs opened yesterday and summarize issues." \
  --workspace /path/to/repo \
  --provider cline \
  --model openai/gpt-5.3-codex \
  --timeout 3600 \
  --max-parallel 1 \
  --tags automation,review
```

Schedule commands:

```sh
clite schedule list
clite schedule get <schedule-id>
clite schedule update <schedule-id> --cron "0 10 * * MON-FRI"
clite schedule trigger <schedule-id>
clite schedule pause <schedule-id>
clite schedule resume <schedule-id>
clite schedule delete <schedule-id>
clite schedule history <schedule-id> --limit 20
clite schedule stats <schedule-id>
clite schedule active
clite schedule upcoming --limit 10
clite schedule export <schedule-id> --to daily-review.yaml
clite schedule import daily-review.yaml
```

`schedule update` supports cron, prompt, name, provider, model, workspace, cwd,
mode, system prompt, timeout, tags, metadata JSON, max parallel, enabled/disabled
state, and pause/resume controls.

### Connectors

Connectors bridge external messaging platforms into CLI sessions.

Available connectors:

| Connector | Platform |
|---|---|
| `telegram` | Telegram Bot |
| `slack` | Slack |
| `gchat` | Google Chat |
| `whatsapp` | WhatsApp |
| `linear` | Linear |

Examples:

```sh
clite connect telegram -m <bot_username> -k <bot_token>
clite connect telegram -i -m <bot_username> -k <bot_token>
clite connect slack --base-url https://your-domain.example
clite connect linear --base-url https://your-domain.example
clite connect --stop
clite connect --stop telegram
```

Shared connector chat commands:

| Command | Description |
|---|---|
| `/help` or `/start` | Show connector command help. |
| `/clear` or `/new` | Start a fresh session. |
| `/abort` | Abort the current running task. |
| `/exit` | Stop the connector process. |
| `/whereami` | Print the delivery thread id. |
| `/tools [on\|off\|toggle]` | Control tool use. |
| `/yolo [on\|off\|toggle]` | Control auto-approve mode. |
| `/cwd <path>` | Change the working directory. |
| `/schedule create\|list\|trigger\|delete` | Manage scheduled deliveries. |

### Agent Teams

Agent teams are core tools that let a lead agent coordinate teammate agents,
shared task state, mailbox messages, mission logs, and converged outcomes.

Team tools include:

- `team_spawn_teammate`
- `team_shutdown_teammate`
- `team_status`
- `team_task`
- `team_run_task`
- `team_cancel_run`
- `team_list_runs`
- `team_await_runs`
- `team_send_message`
- `team_broadcast`
- `team_read_mailbox`
- `team_mission_log`
- `team_create_outcome`
- `team_attach_outcome_fragment`
- `team_review_outcome_fragment`
- `team_finalize_outcome`
- `team_list_outcomes`
- `team_cleanup`

Named team state is stored under the configured team data directory and restores
task board, mailbox, mission log, teammate specs, and run records by team name.

### Sub-Agents

The `spawn_agent` tool lets an agent delegate a bounded task to a child agent.
The child runs in its own session, uses the enabled tool set, records its own
transcript, and returns a result to the parent.

Spawn behavior is controlled by runtime config in core and by CLI flags exposed
through the tool/config surfaces.

## Host Apps

### `@clinebot/code`

`@clinebot/code` is the desktop/Tauri host with a Next.js UI. Provider settings,
model selection, MCP settings, rules, and runtime behavior are driven by SDK
packages and core services.

### `@clinebot/vscode`

`@clinebot/vscode` is the VS Code extension host. It ensures the runtime service,
streams chat/runtime events into the webview, and adapts VS Code UI actions to
core runtime capabilities.

## Integration Patterns

### Direct SDK Integration

Use `@clinebot/core` for app integrations that need sessions, persistence,
tools, config, hub support, settings, and automation.

```ts
import { ClineCore } from "@clinebot/core";

const cline = await ClineCore.create({ backendMode: "auto" });
await cline.start({ prompt, config });
```

Use `@clinebot/agents` directly for a standalone stateless loop when the host
owns persistence, config, and tools.

```ts
import { Agent } from "@clinebot/agents";

const agent = new Agent({ providerId, modelId, apiKey, systemPrompt, tools });
const result = await agent.run("Implement the task.");
```

Use `@clinebot/llms` when building custom provider/model flows or registering
providers.

### Enterprise Integration

Inside this workspace, enterprise behavior should be prepared through
`@clinebot/enterprise`, bridged into core through `prepare`, and consumed through
core's watcher, extension, and telemetry surfaces.

## Verification

For changes that affect package APIs, runtime behavior, or this documentation,
run the relevant checks:

```sh
bun run types
bun run test
bun run check
```

For targeted package work, use the package scripts from the relevant
`package.json`.
