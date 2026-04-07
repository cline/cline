# Cline Custom Plugin Example

Shows how to author a reusable plugin module that works in both the SDK and the CLI. A plugin can:

- **Register tools** — give the agent new capabilities it can invoke
- **Hook into the lifecycle** — observe or influence execution at key points

Code entrypoint: [apps/examples/cline-plugin/index.ts](./apps/examples/cline-plugin/index.ts)

## Use It With The CLI

The CLI does not have a `--plugin` flag yet. It discovers plugin modules from `.cline/plugins` in the workspace.

```bash
mkdir -p .cline/plugins
cp apps/examples/cline-plugin/index.ts .cline/plugins/weather-metrics.ts

clite -i "What's the weather like in Tokyo and Paris?"
```

The module exports `default` and `plugin`, so the CLI loader can import it directly.

## Run The Demo Directly

```bash
ANTHROPIC_API_KEY=sk-... bun run apps/examples/cline-plugin/index.ts
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
import plugin from "./index";

const host = await createSessionHost({});
await host.start({
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    cwd: process.cwd(),
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

| Capability         | What it unlocks                           |
| ------------------ | ----------------------------------------- |
| `tools`            | `api.registerTool()`                      |
| `commands`         | `api.registerCommand()`                   |
| `shortcuts`        | `api.registerShortcut()`                  |
| `flags`            | `api.registerFlag()`                      |
| `message_renderers`| `api.registerMessageRenderer()`           |
| `providers`        | `api.registerProvider()`                  |
| `hooks`            | lifecycle hook handlers (see below)       |

## Available hook stages

| Stage               | Handler               | When it fires                      |
| ------------------- | --------------------- | ---------------------------------- |
| `run_start`         | `onRunStart`          | before the agent starts running    |
| `run_end`           | `onRunEnd`            | after the agent finishes           |
| `iteration_start`   | `onIterationStart`    | before each LLM call               |
| `iteration_end`     | `onIterationEnd`      | after each LLM call                |
| `turn_start`        | `onTurnStart`         | before the model turn              |
| `turn_end`          | `onAgentEnd`          | after the model turn               |
| `tool_call_before`  | `onToolCall`          | before a tool executes             |
| `tool_call_after`   | `onToolResult`        | after a tool executes              |
| `before_agent_start`| `onBeforeAgentStart`  | to override system prompt/messages |
| `session_start`     | `onSessionStart`      | when a session begins              |
| `session_shutdown`  | `onSessionShutdown`   | when a session ends                |
| `input`             | `onInput`             | when the user sends input          |
| `runtime_event`     | `onRuntimeEvent`      | on every agent event               |
| `error`             | `onError`             | when an unhandled error occurs     |

## Context rewriting vs compaction

Plugins do not own context compaction.

Compaction is a core-owned context-pipeline concern that runs through turn preparation before the model call. If a plugin needs to influence the prompt or retained history, use the normal hook surface for prompt/message rewriting rather than a compaction-specific hook.

Example:

```ts
const plugin: Plugin = {
  name: "my-plugin",
  manifest: {
    capabilities: ["hooks"],
    hookStages: ["before_agent_start"],
  },
  onBeforeAgentStart() {
    return {
      systemPrompt:
        "You are a helpful assistant. Prefer concise weather summaries.",
    };
  },
};
```

Notes:

- plugins can still influence prompt construction through supported hook stages
- default compaction strategy selection lives in `@clinebot/core`
- custom compaction should be implemented in the host/core layer, not as a plugin lifecycle hook
