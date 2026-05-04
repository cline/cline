# Cline Custom Plugin Example

Shows how to author a reusable plugin module that works in both the SDK and the CLI. A plugin can:

- **Register tools** — give the agent new capabilities it can invoke
- **Hook into the lifecycle** — observe or influence execution at key points
- **Rewrite provider messages** — add custom context compaction before the model call
- **Emit automation events** — normalize plugin-owned events into ClineCore automation

Example plugins:

- [weather-plugin.example.ts](./weather-plugin.example.ts) - weather tool plus lifecycle metrics hooks
- [mac-notify.ts](./mac-notify.ts) - macOS Notification Center alert on successful run completion
- [automation-events.ts](./automation-events.ts) - local plugin-emitted automation event example
- [custom-compaction.ts](./custom-compaction.ts) - custom summary-based message compaction
- [../../hooks/custom-compaction-hook.ts](../../hooks/custom-compaction-hook.example.ts) - equivalent compaction using a runtime `beforeModel` hook
- [background-terminal.ts](./background-terminal.ts) - detached background shell jobs with persisted logs and optional session steering

## Use It With The CLI

The CLI does not have a `--plugin` flag yet. It discovers plugin modules from `.cline/plugins` in the workspace.

```bash
mkdir -p .cline/plugins
cp apps/examples/plugins/weather-plugin.example.ts .cline/plugins/weather-metrics.ts

cline -i "What's the weather like in Tokyo and Paris?"
```

The module exports `default` and `plugin`, so the CLI loader can import it directly.

To send a macOS Notification Center alert when a run completes successfully:

```bash
mkdir -p .cline/plugins
cp apps/examples/plugins/mac-notify.ts .cline/plugins/mac-notify.ts

cline -i "Run the test suite"
```

The notification example uses the `afterRun` hook and `/usr/bin/osascript`. macOS may ask you to allow notifications for the terminal or host process the first time it fires.

To add custom provider-message compaction before each model call:

```bash
mkdir -p .cline/plugins
cp apps/examples/plugins/custom-compaction.ts .cline/plugins/custom-compaction.ts

cline -i "Search the codebase for dispatcher usage, then summarize it"
```

To add background shell jobs that keep running after the tool call returns:

```bash
mkdir -p .cline/plugins
cp apps/examples/plugins/background-terminal.ts .cline/plugins/background-terminal.ts

cline -i "Start the dev server in the background, then continue with the next task"
```

The background terminal plugin registers three tools:

| Tool | Purpose |
| ---- | ------- |
| `start_background_command` | starts a detached shell command, returns a job id immediately, and stores stdout/stderr under Cline's data directory |
| `get_background_command` | reads job status plus recent stdout/stderr tails |
| `delete_background_command` | deletes saved job metadata, and optionally deletes captured logs |

When `notifyParent` is true or omitted, the plugin emits a `steer_message`
through the host bridge after the command exits. That pushes a completion
summary back into the active session, so the agent can react to long-running
commands without blocking the original tool call.

## Run The Demo Directly

```bash
ANTHROPIC_API_KEY=sk-... bun run apps/examples/plugins/weather-plugin.example.ts
```

## How it works

A plugin is a plain object with four parts:

```ts
const myPlugin: AgentPlugin = {
  // 1. Identity
  name: "my-plugin",

  // 2. Manifest — declare what the plugin does
  manifest: {
    capabilities: ["tools", "hooks"],
  },

  // 3. Setup — register tools, commands, etc.
  setup(api, ctx) {
    api.registerTool(createTool({ ... }));
  },

  // 4. Runtime hooks — observe or influence agent execution
  hooks: {
    beforeRun({ snapshot }) { ... },
    afterRun({ result }) { ... },
  },
};
```

Then pass it to the agent:

```ts
import plugin from "./weather-plugin.example";

const host = await ClineCore.create({ backendMode: "local" });
await host.start({
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    cwd: process.cwd(),
    mode: "act",
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    systemPrompt: "You are a helpful assistant. Use tools when needed.",
    extensions: [plugin],
  },
  prompt: "What's the weather like in Tokyo and Paris?",
  interactive: false,
});
```

## Available capabilities

| Capability         | What it unlocks                              |
| ------------------ | -------------------------------------------- |
| `tools`            | `api.registerTool()`                         |
| `commands`         | `api.registerCommand()`                      |
| `providers`        | `api.registerProvider()`                     |
| `messageBuilders`  | `api.registerMessageBuilder()`               |
| `automationEvents` | `api.registerAutomationEventType()` and `ctx.automation?.ingestEvent()` |
| `hooks`            | runtime lifecycle hook handlers (see below)  |

## Automation event plugins

Plugins can contribute normalized automation event types and, when running in a
`ClineCore` host with automation enabled, emit events through setup context:

```ts
const plugin: AgentPlugin = {
  name: "local-events",
  manifest: { capabilities: ["automationEvents"] },
  setup(api, ctx) {
    api.registerAutomationEventType({
      eventType: "local.plugin_event",
      source: "local-plugin",
      description: "Local normalized event emitted by a plugin",
    });

    void ctx.automation?.ingestEvent({
      eventId: `local-plugin-${Date.now()}`,
      eventType: "local.plugin_event",
      source: "local-plugin",
      occurredAt: new Date().toISOString(),
    });
  },
};
```

The setup context can also include `session`, `client`, `user`, `workspaceInfo`,
`logger`, and `telemetry` when provided by the host. See
[`automation-events.ts`](./automation-events.ts) for a local timer-based demo.

## Runtime Hooks

Plugins use the same runtime hook names as `@clinebot/agents`. These are
in-process callbacks, not file hook event names:

- Runtime hooks: typed in-process plugin/agent lifecycle callbacks such as
  `beforeRun`, `beforeModel`, and `afterTool`.
- File hooks: external scripts discovered from hook config directories and run
  with serialized JSON payloads.
- Hook events: serialized payload names used by file hooks, such as
  `agent_end`, `tool_call`, and `prompt_submit`.

| Hook          | When it fires                                      |
| ------------- | -------------------------------------------------- |
| `beforeRun`   | before the runtime loop starts                     |
| `afterRun`    | after the runtime loop finishes                    |
| `beforeModel` | before each model request                          |
| `afterModel`  | after each model response, before tool execution   |
| `beforeTool`  | before each tool execution                         |
| `afterTool`   | after each tool execution                          |
| `onEvent`     | on every `AgentRuntimeEvent` emitted by the runtime |

`beforeRun` and `afterRun` wrap one `run()` / `continue()` invocation. In an
interactive session, that maps to one submitted user turn. `afterRun` is the
right plugin hook for task completion notifications, but it also fires for
aborted and failed runs, so check `result.status === "completed"` when you only
want successful completion. The equivalent file-hook event is `agent_end`.

## Runtime hooks vs file hooks

File hooks are external scripts discovered from hook config directories such as
`.cline/hooks`. They use serialized event names from `@clinebot/shared`, while
plugin runtime hooks use the typed in-process runtime lifecycle names above.
Core adapts file hooks onto the runtime hook layer before executing the scripts.

| File hook file name | File hook event | Plugin runtime hook backing it |
| ------------------- | --------------- | ------------------------------ |
| `TaskStart` | `agent_start` | `beforeRun` |
| `TaskResume` | `agent_resume` | `beforeRun` with resume context |
| `UserPromptSubmit` | `prompt_submit` | `beforeRun` plus submitted prompt context |
| `PreToolUse` | `tool_call` | `beforeTool` |
| `PostToolUse` | `tool_result` | `afterTool` |
| `TaskComplete` | `agent_end` | `afterRun` when completed |
| `TaskError` | `agent_error` | `afterRun` when failed |
| `TaskCancel` | `agent_abort` | `afterRun` or session shutdown with abort/cancel reason |
| `SessionShutdown` | `session_shutdown` | session cleanup / runtime shutdown |
| `PreCompact` | not wired for file hooks today | none |

Use file hooks for user/workspace-configured scripts. Use plugin runtime hooks
when the behavior belongs to a reusable extension and needs typed access to the
runtime snapshot, model request, tool context, or emitted runtime events.

For custom message compaction, use a plugin runtime hook such as `beforeModel`
or the `messageBuilders` API. That is separate from the serialized
`pre_compact` hook-event payload type, and `PreCompact` files are not currently
wired into file-hook execution.

### Naming note

The current public plugin field is `hooks` because it is the runtime-native
extension field consumed by the agent. In user-facing docs and examples, call
these **runtime hooks** to avoid confusing them with file hook events. If the
plugin API is renamed before the SDK has external consumers, prefer
`runtimeHooks` for `AgentPlugin` and reserve **file hooks** for the external
script/event system.

## Custom message compaction

Use `messageBuilders` when a plugin needs to transform the provider-bound
message list before the model call. Message builders run after runtime messages
are converted into SDK message blocks and before the built-in API safety pass,
so core still applies final provider-safe truncation afterward.

See [`custom-compaction.ts`](./custom-compaction.ts) for a full
plugin that estimates context size, preserves the first user message and recent
working context, and replaces older middle history with one continuation summary.

There is also a runtime-hook version at
[`../../hooks/custom-compaction-hook.example.ts`](../../hooks/custom-compaction-hook.example.ts).
Both examples perform similar compaction, but they run at different layers:

| Example | Extension point | Message shape | Best for |
| ------- | --------------- | ------------- | -------- |
| `custom-compaction.ts` | `api.registerMessageBuilder()` | SDK/provider-bound `Message[]` after runtime messages are converted for model delivery | most reusable plugin-owned message rewrites and compaction policies |
| `../../hooks/custom-compaction-hook.example.ts` | `hooks.beforeModel` runtime hook | Agent runtime request messages with runtime parts such as `tool-call`, `tool-result`, `reasoning`, `image`, and `file` | cases that need runtime-hook context, the current runtime snapshot, or direct request mutation |

Prefer the message-builder version for normal plugin-owned compaction because
it runs in the core message pipeline before the built-in provider-safety
builder. Use the `beforeModel` runtime-hook version when the logic needs access
to runtime hook context or the exact runtime request object.

Notes:

- message builders receive and return `Message[]`
- builders may be sync or async
- multiple builders run in plugin registration order
- the built-in core message builder runs last to normalize input and enforce provider-safe truncation
- use `beforeModel` hooks for runtime request changes; use message builders for message-list rewrites
