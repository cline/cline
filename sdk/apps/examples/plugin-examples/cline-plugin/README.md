# Cline Custom Plugin Example

Shows how to author a reusable plugin module that works in both the SDK and the CLI. A plugin can:

- **Register tools** — give the agent new capabilities it can invoke
- **Hook into the lifecycle** — observe or influence execution at key points
- **Rewrite provider messages** — add custom context compaction before the model call
- **Emit automation events** — normalize plugin-owned events into ClineCore automation

Example plugins:

- [weather-plugin.example.ts](./weather-plugin.example.ts) - weather tool plus lifecycle metrics hooks
- [mac-notify.example.ts](./mac-notify.example.ts) - macOS Notification Center alert on successful run completion
- [automation-events.ts](./automation-events.ts) - local plugin-emitted automation event example
- [custom-compaction.example.ts](./custom-compaction.example.ts) - custom summary-based message compaction

## Use It With The CLI

The CLI does not have a `--plugin` flag yet. It discovers plugin modules from `.cline/plugins` in the workspace.

```bash
mkdir -p .cline/plugins
cp apps/examples/plugin-examples/cline-plugin/weather-plugin.example.ts .cline/plugins/weather-metrics.ts

cline -i "What's the weather like in Tokyo and Paris?"
```

The module exports `default` and `plugin`, so the CLI loader can import it directly.

To send a macOS Notification Center alert when a run completes successfully:

```bash
mkdir -p .cline/plugins
cp apps/examples/plugin-examples/cline-plugin/mac-notify.example.ts .cline/plugins/mac-notify.ts

cline -i "Run the test suite"
```

The notification example uses the `run_end` hook and `/usr/bin/osascript`. macOS may ask you to allow notifications for the terminal or host process the first time it fires.

To add custom provider-message compaction before each model call:

```bash
mkdir -p .cline/plugins
cp apps/examples/plugin-examples/cline-plugin/custom-compaction.example.ts .cline/plugins/custom-compaction.ts

cline -i "Search the codebase for dispatcher usage, then summarize it"
```

## Run The Demo Directly

```bash
ANTHROPIC_API_KEY=sk-... bun run apps/examples/plugin-examples/cline-plugin/weather-plugin.example.ts
```

## How it works

A plugin is a plain object with three parts:

```ts
const myPlugin: Plugin = {
  // 1. Identity
  name: "my-plugin",

  // 2. Manifest — declare what the plugin does
  manifest: {
    capabilities: ["tools", "hooks"],
    hookStages: ["run_start", "run_end"], // list every hook you implement
  },

  // 3. Setup — register tools, commands, etc.
  setup(api) {
    api.registerTool(createTool({ ... }));
  },

  // 4. Hooks — observe or influence agent execution
  onRunStart({ userMessage }) { ... },
  onRunEnd({ result }) { ... },
};
```

Then pass it to the agent:

```ts
import plugin from "./weather-plugin.example";

const host = await ClineCore.create({});
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
| `hooks`            | lifecycle hook handlers (see below)          |

## Automation event plugins

Plugins can contribute normalized automation event types and, when running in a
`ClineCore` host with automation enabled, emit events through setup context:

```ts
const plugin: Plugin = {
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
[`automation-events.ts`](./automation-events.ts) for a local timer-based demo
that cleans up with the `session_shutdown` hook.

## Available hook stages

| Stage                | Handler               | When it fires                                                                                 |
| -------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| `session_start`      | `onSessionStart`      | once when the session is first initialized                                                    |
| `input`              | `onInput`             | when the user sends input                                                                     |
| `run_start`          | `onRunStart`          | once per `run()` / `continue()`, before the first iteration                                  |
| `iteration_start`    | `onIterationStart`    | at the top of every loop iteration, before turn construction begins                           |
| `turn_start`         | `onTurnStart`         | after iteration setup, with the current message list, before prompt preparation               |
| `before_agent_start` | `onBeforeAgentStart`  | immediately before the model call — last chance to replace system prompt or append messages   |
| `turn_end`           | `onTurnEnd`           | after the model responds, before any tool calls execute                                       |
| `tool_call_before`   | `onToolCall`          | before each individual tool executes                                                          |
| `tool_call_after`    | `onToolResult`        | after each individual tool executes                                                           |
| `iteration_end`      | `onIterationEnd`      | at the end of a loop iteration, after all tool calls for that iteration have completed        |
| `run_end`            | `onRunEnd`            | once after the agent loop finishes (all iterations done)                                      |
| `stop_error`         | `onAgentError`        | when a turn error stops forward progress for the current run                                  |
| `session_shutdown`   | `onSessionShutdown`   | when the session is shutting down                                                             |
| `error`              | `onError`             | when an unhandled error is thrown in the agent loop                                           |
| `runtime_event`      | `onRuntimeEvent`      | on every agent event emitted during the run                                                   |

> **`turn_end` vs `iteration_end`:** Within a single iteration the order is `turn_end` → *(tool calls)* → `iteration_end`. Use `turn_end` to inspect or react to the model's raw response before tools run; use `iteration_end` when you need to observe the outcome of the full round-trip including all tool results.

## Custom message compaction

Use `messageBuilders` when a plugin needs to transform the provider-bound
message list before the model call. Message builders run after runtime messages
are converted into SDK message blocks and before the built-in API safety pass,
so core still applies final provider-safe truncation afterward.

See [`custom-compaction.example.ts`](./custom-compaction.example.ts) for a full
plugin that estimates context size, preserves the first user message and recent
working context, and replaces older middle history with one continuation summary.

Notes:

- message builders receive and return `Message[]`
- builders may be sync or async
- multiple builders run in plugin registration order
- the built-in core message builder runs last to normalize input and enforce provider-safe truncation
- use `before_agent_start` hooks for system-prompt changes; use message builders for message-list rewrites
