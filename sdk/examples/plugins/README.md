# Cline Plugin Examples

A plugin is a single file (or directory) that extends any Cline agent — CLI, Kanban, VS Code, JetBrains, or anything built on the Core SDK. Drop one in, get new tools, hooks, providers, or message rewriters everywhere.

What a plugin can do:

- **Register tools** — give the agent new capabilities it can call
- **Hook into the lifecycle** — observe or steer execution at key points
- **Rewrite provider messages** — custom compaction, redaction, context shaping
- **Emit automation events** — push normalized events into the runtime

## Examples

| Example | What it shows |
| ------- | ------------- |
| [weather-metrics.ts](./weather-metrics.ts) | Tool registration + lifecycle metrics hooks. Best starting point. |
| [mac-notify.ts](./mac-notify.ts) | macOS Notification Center alert via `afterRun` |
| [custom-compaction.ts](./custom-compaction.ts) | Provider-message compaction via `registerMessageBuilder` |
| [background-terminal.ts](./background-terminal.ts) | Detached shell jobs with persisted logs and session steering |
| [automation-events.ts](./automation-events.ts) | Plugin-emitted automation events |
| [gitignore-read-files-guard.ts](./gitignore-read-files-guard.ts) | Runtime hook policy for workspace `.gitignore` boundaries |
| [web-search.ts](./web-search.ts) | `web_search` tool backed by an Exa API key |
| [typescript-lsp/](./typescript-lsp/) | `goto_definition` tool powered by the TypeScript Language Service |
| [agents-squad/](./agents-squad/) | Multi-agent team — spin up subagents with their own models and personalities |

The runtime-hook variant of compaction lives in [../hooks/custom-compaction-hook.example.ts](../hooks/custom-compaction-hook.example.ts).

## Try it with the CLI

The CLI auto-discovers plugins from `.cline/plugins` in the workspace, `~/.cline/plugins`, and the system Plugins folder. Drop a file in, run `cline`:

```bash
mkdir -p .cline/plugins
cp examples/plugins/weather-metrics.ts .cline/plugins/

cline -i "What's the weather like in Tokyo and Paris?"
```

Swap `weather-metrics.ts` for any other example. Each one ships ready to copy.

To block file access for paths ignored by workspace `.gitignore` files:

```bash
cp examples/plugins/gitignore-read-files-guard.ts .cline/plugins/

cline -i "Read the ignored .env file"
```

The guard uses the `beforeTool` runtime hook. When a `read_files`, `editor`, or `apply_patch` call targets an ignored workspace file, the hook returns `{ skip: true }`, so the tool result records a policy error and the file is not accessed.

For a plugin that lives in a directory (with its own `package.json`), use `cline plugin install`:

```bash
cline plugin install ./examples/plugins/agents-squad
```

To add web search through a normal plugin tool:

```bash
mkdir -p .cline/plugins
cp examples/plugins/web-search.ts .cline/plugins/web-search.ts

export EXA_API_KEY=...
export OPENROUTER_API_KEY=...

cline auth --provider openrouter --apikey "$OPENROUTER_API_KEY" --modelid anthropic/claude-sonnet-4.6
cline -P openrouter -m anthropic/claude-sonnet-4.6 "Search the web for recent Bun release notes, then fetch the most relevant page"
```

The plugin registers `web_search`, which returns normalized search results from
Exa. It is intentionally separate from `fetch_web_content`: use `web_search` to
discover relevant URLs, then use `fetch_web_content` when the agent needs to
inspect a specific page. `EXA_API_KEY` only authenticates the search backend;
the CLI still needs a normal model provider key or saved provider auth for
inference.

## Run a demo directly

```bash
ANTHROPIC_API_KEY=sk-... bun run examples/plugins/weather-metrics.ts
```

## Anatomy of a plugin

```ts
import type { AgentPlugin } from "@cline/core";
import { createTool } from "@cline/core";

const myPlugin: AgentPlugin = {
  name: "my-plugin",

  manifest: {
    capabilities: ["tools", "hooks"],
  },

  setup(api, ctx) {
    api.registerTool(createTool({ /* ... */ }));
  },

  hooks: {
    beforeRun({ snapshot }) { /* ... */ },
    afterRun({ result }) { /* ... */ },
  },
};

export default myPlugin;
```

Pass it to the SDK:

```ts
import plugin from "./my-plugin";
import { ClineCore } from "@cline/core";

const host = await ClineCore.create({ backendMode: "local" });
await host.start({
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    cwd: process.cwd(),
    enableTools: true,
    systemPrompt: "You are a helpful assistant.",
    extensions: [plugin],
  },
  prompt: "What's the weather like in Tokyo and Paris?",
  interactive: false,
});
```

## Capabilities

Declare what the plugin uses in `manifest.capabilities`. Each one unlocks one part of the `api` passed to `setup()`:

| Capability         | What it unlocks |
| ------------------ | --------------- |
| `tools`            | `api.registerTool()` |
| `commands`         | `api.registerCommand()` |
| `providers`        | `api.registerProvider()` |
| `messageBuilders`  | `api.registerMessageBuilder()` |
| `automationEvents` | `api.registerAutomationEventType()` and `ctx.automation?.ingestEvent()` |
| `hooks`            | runtime lifecycle callbacks (see below) |

The setup `ctx` may include `session`, `client`, `user`, `workspaceInfo`, `automation`, `logger`, and `telemetry` depending on the host. See [`automation-events.ts`](./automation-events.ts) for an end-to-end example.

## Runtime hooks

Hooks are typed, in-process callbacks on the same hook layer as `@cline/agents`. They run inside the agent loop with full type information.

| Hook          | When it fires |
| ------------- | ------------- |
| `beforeRun`   | before the runtime loop starts |
| `afterRun`    | after the runtime loop finishes |
| `beforeModel` | before each model request |
| `afterModel`  | after each model response, before tool execution |
| `beforeTool`  | before each tool execution |
| `afterTool`   | after each tool execution |
| `onEvent`     | every `AgentRuntimeEvent` emitted by the runtime |

`beforeRun` and `afterRun` wrap one `run()` / `continue()` invocation — in an interactive session, that's one user turn. `afterRun` is the right place for completion notifications, but it also fires on aborted and failed runs, so check `result.status === "completed"` if you only want successes.

### Plugin hooks vs file hooks

File hooks are external scripts in `.cline/hooks` that the runtime invokes with serialized JSON payloads. Plugin runtime hooks are typed callbacks inside the agent loop. Core adapts file hooks onto the runtime hook layer.

| File hook | File event | Backed by runtime hook |
| --------- | ---------- | ---------------------- |
| `TaskStart` | `agent_start` | `beforeRun` |
| `TaskResume` | `agent_resume` | `beforeRun` with resume context |
| `UserPromptSubmit` | `prompt_submit` | `beforeRun` with prompt context |
| `PreToolUse` | `tool_call` | `beforeTool` |
| `PostToolUse` | `tool_result` | `afterTool` |
| `TaskComplete` | `agent_end` | `afterRun` (completed) |
| `TaskError` | `agent_error` | `afterRun` (failed) |
| `TaskCancel` | `agent_abort` | `afterRun` or session shutdown |
| `SessionShutdown` | `session_shutdown` | session cleanup |

Use **file hooks** for user- or workspace-configured scripts. Use **plugin runtime hooks** when the behavior belongs to a reusable extension and needs typed access to the runtime.

## Custom message compaction

Use `registerMessageBuilder` when a plugin needs to rewrite the provider-bound message list before the model call. Builders run after runtime messages are converted into SDK message blocks and before core's built-in safety pass — so provider-safe normalization is still the final word.

| Example | Extension point | Best for |
| ------- | --------------- | -------- |
| [`custom-compaction.ts`](./custom-compaction.ts) | `api.registerMessageBuilder()` | reusable, plugin-owned compaction policies |
| [`../hooks/custom-compaction-hook.example.ts`](../hooks/custom-compaction-hook.example.ts) | `hooks.beforeModel` runtime hook | logic that needs runtime hook context or direct request mutation |

Prefer the message-builder version for normal compaction. It runs in the core message pipeline before the built-in safety builder, multiple builders run in registration order, and the final pass enforces provider-safe truncation.

Reach for `beforeModel` only when you need the runtime snapshot or want to mutate the runtime request object itself.

## Background terminal plugin

[`background-terminal.ts`](./background-terminal.ts) registers three tools for long-running shell jobs:

| Tool | Purpose |
| ---- | ------- |
| `start_background_command` | starts a detached shell command, returns a job id immediately, captures stdout/stderr under Cline's data directory |
| `get_background_command` | reads job status plus recent stdout/stderr tails |
| `delete_background_command` | deletes saved job metadata, optionally deletes captured logs |

When `notifyParent` is true (the default), the plugin emits a `steer_message` through the host bridge after the command exits, pushing a completion summary back into the active session — so the agent can react to long-running commands without blocking the original tool call.
