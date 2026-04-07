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

Behavior notes:

- shared contracts should be reusable by multiple higher layers
- path/search helpers define the default config discovery locations used elsewhere in the stack

## `@clinebot/llms`

Primary role: provider/model runtime layer.

Important exported areas:

- provider settings/config helpers
- model catalog helpers
- handler creation
- provider manifests and runtime registry

Behavior notes:

- provider execution is organized around protocol families, not just provider ids
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

- extensions register contributions such as tools, commands, shortcuts, flags, renderers, and providers
- hooks intercept lifecycle stages and can influence execution

Use extensions for additive runtime surface.
Use hooks for lifecycle interception and policy.

### Context Limit Handling

The agent runtime includes a context-limit lifecycle stage:

- `context_limit_reached`

Behavior:

- the agent measures turn usage against the active context window
- when the threshold is crossed, it dispatches `context_limit_reached`
- hook or extension handlers may return `replaceMessages` to rewrite history before the next model turn
- if no handler replaces history, higher-level runtimes may supply a fallback compaction policy

Important API note:

- custom compaction is exposed through hooks/extensions, not through a public `AgentConfig.compaction` field
- `onContextLimitReached(ctx)` is the supported plugin surface for custom compaction logic

## `@clinebot/scheduler`

Primary role: scheduled execution and bounded autonomous routines.

Important exported areas:

- schedule store
- scheduler service
- cron helpers
- concurrency/resource limiter

Behavior notes:

- scheduler enforces timeout and concurrency limits
- scheduler is typically consumed behind RPC rather than directly by most host apps

## `@clinebot/rpc`

Primary role: cross-process runtime gateway.

Important exported areas:

- RPC server startup
- client helpers
- runtime session APIs
- approval/event routing
- schedule gateway APIs

Behavior notes:

- RPC transports runtime/session capabilities across process boundaries
- business logic should stay in lower packages where possible rather than being duplicated in the RPC layer

## `@clinebot/core`

Primary role: stateful orchestration over the stateless agent runtime.

Important exported areas:

- `ClineCore`
- session host/session manager types
- runtime builder
- config watchers/loaders
- default tools and tool routing
- provider settings management
- telemetry factories

### Runtime Composition

Core composes the runtime from:

- provider config
- tools
- hooks
- extensions
- default context compaction policy
- user instruction watcher
- telemetry

### Session Behavior

Core owns:

- session lifecycle
- message persistence
- transcript and hook artifact persistence
- pending prompt queueing
- team/session persistence
- checkpoint hooks
- default context compaction injection for root sessions

### Context Compaction

Core provides a built-in default compaction policy for root sessions.

Behavior:

- core injects a default compaction policy when constructing the root agent
- the default policy supports two built-in strategies:
  - `agentic`: summarize older history with a model and roll summaries forward
  - `basic`: compact locally without calling a model
- extensions still run first through `onContextLimitReached`
- plugin-provided history replacement takes precedence over the core fallback

Integration rule:

- if a host or plugin needs custom compaction behavior, prefer an extension hook
- do not rely on a public `AgentConfig.compaction` field
- delegated and spawned agents inherit extension-based compaction behavior through their `extensions`

### Session Bootstrap

`ClineCore.create(...)` accepts an optional `prepare(input)` hook.

Use it when a higher-level integration needs to prepare workspace-scoped runtime
state before core starts a session, then attach the result through existing
generic seams.

The returned bootstrap can:

- transform the `StartSessionInput`
- attach a `UserInstructionConfigWatcher`
- add extensions
- provide telemetry
- register cleanup with `dispose()`

### Interactive Queueing

Turn requests support:

- `delivery: "queue"`
- `delivery: "steer"`

Behavior:

- queued turns are stored as pending prompts
- steer inserts at the front of the pending queue
- attachments are preserved
- core emits queue-related events and should be treated as the source of truth

### Telemetry

Core supports:

- basic telemetry service usage
- OpenTelemetry-backed telemetry factories

The main integration pattern is:

1. construct a telemetry service
2. pass it to the host or session config
3. flush/dispose it at the host boundary

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

`createEnterprisePlugin(...)` returns a valid `AgentExtension`.

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

### `@clinebot/desktop`

Desktop board/task host with subprocess-per-task execution patterns.

Notable behaviors:

- uses persistent session/runtime state and host orchestration over SDK primitives

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
