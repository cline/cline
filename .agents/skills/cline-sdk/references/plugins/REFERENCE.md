# Plugins

A Cline plugin is a TypeScript module that extends any agent built on the Cline SDK. The same plugin runs in the Cline CLI, VS Code and JetBrains extensions, and any custom app built on `@cline/core`.

A plugin can:

- Register tools the model can call.
- Hook into the agent loop before/after runs, model calls, and tool calls.
- Rewrite provider messages before they hit the model (custom compaction, redaction, context shaping).
- Register slash commands, prompt rules, providers, and automation event types.

A plugin ships in one of two shapes:

1. Single-file plugin -- one `.ts` file that exports a default plugin object. Drop it in a discovery folder and it loads.
2. Plugin package -- a directory with `package.json`, npm dependencies, and optionally bundled assets. Installable via `cline plugin install`.

Both shapes use the same plugin API.

## The Mental Model

When the host starts a session, it builds a registry of plugins and runs four phases:

1. resolve -- collect the plugin objects.
2. validate -- check each plugin's `manifest`. Capabilities must be non-empty; declared hook stages must have matching handlers; if `hooks` is present, `"hooks"` must be in `capabilities`.
3. setup -- call each plugin's `setup(api, ctx)` once. This is where you `registerTool`, `registerCommand`, etc.
4. activate -- registry is frozen, the agent loop starts, and your hooks/tools are live.

Two invariants the registry enforces:

- Every contribution requires a matching capability. Calling `api.registerRule(...)` without `"rules"` in `manifest.capabilities` throws.
- Capabilities and handlers must agree. Declaring `"hooks"` without a `hooks` object, or vice versa, fails validation.

After validation, registration is one-shot -- no dynamic register/unregister during the session.

## The Smallest Working Plugin

```typescript
import type { AgentPlugin } from "@cline/core"
import { createTool } from "@cline/core"

const plugin: AgentPlugin = {
  name: "hello-plugin",
  manifest: {
    capabilities: ["tools"],
  },
  setup(api, ctx) {
    api.registerTool(
      createTool({
        name: "say_hello",
        description: "Greet a person by name.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        async execute({ name }: { name: string }) {
          return { greeting: `Hello, ${name}!` }
        },
      }),
    )
  },
}

export default plugin
```

The agent will see `say_hello` as a callable tool.

## The Manifest

```typescript
manifest: {
  capabilities: ["tools", "hooks"],   // required, non-empty array
  paths?: string[],                   // optional, multi-entry packages
  providerIds?: string[],             // optional, provider plugins
  modelIds?: string[],                // optional, model plugins
}
```

### The Complete Capability List

| Capability | What It Unlocks in `api` |
|-----------|--------------------------|
| `"tools"` | `api.registerTool()` |
| `"commands"` | `api.registerCommand()` (slash commands in chat surfaces) |
| `"rules"` | `api.registerRule()` (string injected into the system prompt) |
| `"messageBuilders"` | `api.registerMessageBuilder()` (rewrites provider-bound messages) |
| `"providers"` | `api.registerProvider()` (custom model provider) |
| `"automationEvents"` | `api.registerAutomationEventType()` and `ctx.automation?.ingestEvent()` |
| `"hooks"` | The runtime `hooks` object on the plugin (lifecycle callbacks) |

You declare any combination -- most real plugins need 1-3 capabilities.

## setup(api, ctx) -- The Registration Phase

`setup()` runs once per session before the agent loop starts. Everything you register here is frozen for the lifetime of the session.

### The api Object

Each `register*` method requires the matching capability in your manifest:

```typescript
api.registerTool(tool)                              // requires "tools"
api.registerCommand({ name, description, handler }) // requires "commands"
api.registerRule({ id, content, source })            // requires "rules"
api.registerMessageBuilder({ name, build })          // requires "messageBuilders"
api.registerProvider({ name, description })          // requires "providers"
api.registerAutomationEventType({ eventType, source }) // requires "automationEvents"
```

### The ctx Object -- Host-Provided Session Context

The second argument carries everything the host knows about the current session. All fields are optional, so feature-detect before using them -- the same plugin must work in hosts that supply less context (unit tests, sandboxed plugin processes).

```typescript
ctx.session?.sessionId       // string, stable core session id
ctx.client?.name             // host: "cline-cli", "cline-vscode", etc.
ctx.user                     // authenticated user/org info, when available
ctx.workspaceInfo            // { rootPath, hint, latestGitBranchName,
                             //   latestGitCommitHash, associatedRemoteUrls }
ctx.automation?.ingestEvent  // emit normalized automation events
ctx.logger?.log              // structured logger scoped to this plugin
ctx.telemetry                // ITelemetryService, only present in-process
```

Two rules about `ctx.workspaceInfo`:

1. Always prefer `ctx.workspaceInfo?.rootPath` over `process.cwd()`. The CLI may have been launched with `--cwd` without calling `chdir`, and VS Code workspaces don't share a single CWD. `workspaceInfo` is sourced from the session config and is always correct.
2. Don't use `import.meta.url` tricks to find "the workspace". That gives you the plugin's own location, not the user's project.

### Persisting State Across Hooks

`setup()` runs first; hooks fire later. The simplest way to share state is module-level variables:

```typescript
let sessionWorkspaceRoot: string | undefined
let sessionBranch: string | undefined

const plugin: AgentPlugin = {
  name: "metrics",
  manifest: { capabilities: ["hooks"] },
  setup(api, ctx) {
    sessionWorkspaceRoot = ctx.workspaceInfo?.rootPath
    sessionBranch = ctx.workspaceInfo?.latestGitBranchName
  },
  hooks: {
    beforeTool({ toolCall, input }) {
      if (sessionBranch === "main" && toolCall.toolName === "run_commands") {
        // inspect input, optionally block
      }
      return undefined
    },
  },
}
```

A single Node process may host multiple sessions concurrently. If your plugin will run in a multi-session host, key your state by `ctx.session?.sessionId`:

```typescript
const stateBySession = new Map<string, MyState>()
setup(api, ctx) {
  const id = ctx.session?.sessionId
  if (id) stateBySession.set(id, /* ... */)
}
```

## Runtime Hooks

Runtime hooks are typed in-process callbacks on the same hook layer the runtime uses internally. They run inside the agent loop with full type information -- no IPC, no JSON marshaling.

Declare `"hooks"` in `manifest.capabilities`, then add a `hooks` property:

```typescript
const plugin: AgentPlugin = {
  name: "metrics",
  manifest: { capabilities: ["hooks"] },
  hooks: {
    beforeRun(ctx) { /* ... */ },
    beforeTool({ toolCall, input }) { /* ... */ },
    afterTool({ toolCall, result }) { /* ... */ },
    afterRun({ result }) { /* ... */ },
    onEvent(event) { /* ... */ },
  },
}
```

### The Seven Hooks

| Hook | Fires | Can Stop the Loop? | Common Uses |
|------|-------|--------------------|-------------|
| `beforeRun` | Before the runtime loop starts | Yes | Greet, log, attach session metadata |
| `afterRun` | After the runtime loop finishes (success, abort, or fail) | No | Notifications, metrics, persistent logs |
| `beforeModel` | Before each model request | Yes (mutate req) | Inject context, last-mile prompt edits |
| `afterModel` | After each model response, before tool execution | Yes | Block based on model output |
| `beforeTool` | Before each tool execution | Yes (`{ stop }`) | Audit, redact, block dangerous tools |
| `afterTool` | After each tool execution | Can replace result | Post-process, redact secrets in tool output |
| `onEvent` | On every `AgentRuntimeEvent` emitted by the runtime | No | Streaming UIs, telemetry pipes |

### Stopping the Loop from a Hook

Several hooks return an optional control object. The most common pattern is `beforeTool` blocking a destructive tool call:

```typescript
beforeTool({ toolCall, input }) {
  if (toolCall.toolName === "run_commands") {
    const { commands } = input as { commands?: string[] }
    if (sessionBranch === "main" && commands?.some(c => c.startsWith("git push"))) {
      return { stop: true, reason: "Blocked git push on protected branch" }
    }
  }
  return undefined  // explicit "continue"
}
```

Returning `undefined` (or omitting `return`) lets execution continue normally.

### afterRun Semantics

`afterRun` fires for every terminal status -- `completed`, `aborted`, `failed`. If you only want to act on success:

```typescript
afterRun({ result }) {
  if (result.status !== "completed") return
  // notify, log success metrics, etc.
}
```

### Plugin Hooks vs File Hooks

The runtime supports two hook systems:

- File hooks -- external scripts in `.cline/hooks/` invoked with serialized JSON. Right for user/workspace-specific scripts that don't ship with code.
- Plugin runtime hooks -- typed in-process callbacks. Right when the behavior belongs to a reusable extension and needs typed access to the runtime.

Core adapts file hooks onto the runtime hook layer, so you don't need both. If you're shipping a plugin, write it as runtime hooks.

## Message Builders

Message builders rewrite the provider-bound message list before the model call. They run after runtime messages are converted into SDK message blocks but before core's built-in safety builder.

Use them for:

- Custom compaction policies (replace middle history with a summary).
- Redacting PII or secrets before they reach the provider.
- Reshaping context for a specific model's strengths.

```typescript
api.registerMessageBuilder({
  name: "summarize-middle-history",
  build(messages) {
    if (estimateTokens(messages) < THRESHOLD) return messages
    return [...prefix, summary, ...recent]
  },
})
```

Multiple builders run in registration order; the output of one is the input of the next.

When to use `beforeModel` instead: reach for the `beforeModel` hook only if you need the runtime snapshot or want to mutate the request object itself. Pure message rewrites belong in a builder.

## Automation Events

Plugins can declare normalized event types and emit them into Cline automation. Hosts that don't have automation enabled simply ignore both -- feature-detect `ctx.automation`.

```typescript
manifest: { capabilities: ["automationEvents"] },

setup(api, ctx) {
  api.registerAutomationEventType({
    eventType: "github.pull_request.opened",
    source: "github",
    description: "A new GitHub PR was opened",
    attributesSchema: { /* JSON Schema for envelope.attributes */ },
  })

  if (!ctx.automation) return  // host has no automation
  ctx.automation.ingestEvent({
    eventId: "pr-1234",
    eventType: "github.pull_request.opened",
    source: "github",
    subject: "owner/repo#1234",
    occurredAt: new Date().toISOString(),
    attributes: { /* ... */ },
  })
}
```

## Loading a Plugin

There are three ways a plugin gets into a session:

### Auto-Discovery (CLI)

The CLI scans these directories on startup:

- `<workspace>/.cline/plugins/` -- project-scoped plugins.
- `~/.cline/plugins/` -- user-scoped plugins.

Drop a `.ts` or `.js` file in, run `cline`, done:

```bash
mkdir -p .cline/plugins
cp my-plugin.ts .cline/plugins/
cline -i "do the thing my plugin enables"
```

### Explicit extensions in SDK Config

When you build your own host with `ClineCore`, pass the plugin object directly:

```typescript
import plugin from "./my-plugin"
import { ClineCore } from "@cline/core"

const host = await ClineCore.create({ backendMode: "local" })
await host.start({
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    cwd: process.cwd(),
    enableTools: true,
    systemPrompt: "You are a helpful assistant.",
    extensions: [plugin],
    extensionContext: {
      workspace: { rootPath: process.cwd(), cwd: process.cwd() },
    },
  },
  prompt: "...",
  interactive: false,
})
```

### pluginPaths for Directory-Based Plugins

When the plugin is a directory with `package.json`, point `pluginPaths` at the directory:

```typescript
config: {
  pluginPaths: ["./path/to/my-plugin-package"],
}
```

Or install with the CLI:

```bash
cline plugin install ./path/to/my-plugin-package
cline plugin install @scope/my-cline-plugin       # from npm
cline plugin install --git github.com/owner/repo  # from git
```

## Single-File Plugin Template

Save as `my-plugin.ts`, drop in `.cline/plugins/`:

```typescript
import { type AgentPlugin, ClineCore, createTool } from "@cline/core"

let sessionRoot: string | undefined

const plugin: AgentPlugin = {
  name: "my-plugin",
  manifest: {
    capabilities: ["tools", "hooks"],
  },

  setup(api, ctx) {
    sessionRoot = ctx.workspaceInfo?.rootPath

    api.registerTool(
      createTool({
        name: "do_thing",
        description: "Do the thing this plugin exists for.",
        inputSchema: {
          type: "object",
          properties: { target: { type: "string" } },
          required: ["target"],
        },
        async execute(input) {
          const { target } = input as { target: string }
          return { ok: true, target, root: sessionRoot }
        },
      }),
    )
  },

  hooks: {
    beforeRun() {
      console.log("[my-plugin] run started")
    },
    afterRun({ result }) {
      if (result.status !== "completed") return
      console.log(`[my-plugin] done in ${result.iterations} iteration(s)`)
    },
  },
}

async function runDemo(): Promise<void> {
  const host = await ClineCore.create({ backendMode: "local" })
  try {
    const result = await host.start({
      config: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
        apiKey: process.env.ANTHROPIC_API_KEY ?? "",
        cwd: process.cwd(),
        enableTools: true,
        systemPrompt: "You are a helpful assistant. Use tools when needed.",
        extensions: [plugin],
        extensionContext: {
          workspace: { rootPath: process.cwd(), cwd: process.cwd() },
        },
      },
      prompt: "Use do_thing on the target 'world'.",
      interactive: false,
    })
    console.log(result.result?.text ?? "")
  } finally {
    await host.dispose()
  }
}

if (import.meta.main) {
  await runDemo()
}

export { plugin, runDemo }
export default plugin
```

Copy it, rename the tool, swap in your logic. The `runDemo()` function lets you test with `ANTHROPIC_API_KEY=sk-... bun run my-plugin.ts`.

## Plugin Package

Use a plugin package when you need npm dependencies, multiple entry points, bundled assets, or npm/git distribution.

### Layout

```
my-cline-plugin/
+-- package.json
+-- tsconfig.json          (optional, for local typechecking)
+-- index.ts               (the plugin entry point)
+-- README.md
+-- assets/                (optional, bundled content)
    +-- templates/
    +-- schemas/
```

### package.json -- The Discovery Contract

```json
{
  "name": "my-cline-plugin",
  "version": "0.1.0",
  "private": true,
  "description": "What this plugin does, in one sentence.",
  "type": "module",
  "exports": {
    ".": "./index.ts"
  },
  "cline": {
    "plugins": [
      {
        "paths": ["./index.ts"],
        "capabilities": ["tools", "hooks"]
      }
    ]
  },
  "peerDependencies": {
    "@cline/core": "*"
  },
  "peerDependenciesMeta": {
    "@cline/core": { "optional": true }
  },
  "dependencies": {
    "zod": "^4.1.5"
  }
}
```

Key fields:

- `type: "module"` -- required. Cline plugins are ES modules.
- `cline.plugins` -- the discovery contract. Array of entries, each with `paths` (entry files) and `capabilities` (pre-declared, validated before importing).
- `peerDependencies` for `@cline/core` -- the host already provides it. Marking it optional lets you typecheck in isolation.

### Bundling Assets

Resolve asset paths with `import.meta.url`, not `process.cwd()`:

```typescript
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync, existsSync } from "node:fs"

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(MODULE_DIR, "assets", "templates")

function loadTemplate(name: string): string | undefined {
  const path = join(TEMPLATES_DIR, `${name}.md`)
  return existsSync(path) ? readFileSync(path, "utf8") : undefined
}
```

This is the only place `import.meta.url` is appropriate in a plugin -- locating files inside the plugin package. For workspace paths, always use `ctx.workspaceInfo?.rootPath`.

### The Override Pattern (Bundled / Global / Project)

A package can ship default assets and let users override them. The convention is a three-tier lookup, last write wins by `name`:

1. bundled -- files inside the plugin package (defaults shipped with the plugin).
2. global -- files under `~/.cline/data/settings/<kind>/` (user overrides).
3. project -- files under `<workspace>/.cline/<kind>/` (project overrides).

### Multiple Plugin Entries

If your package exposes more than one plugin, list each in `cline.plugins`:

```json
"cline": {
  "plugins": [
    { "paths": ["./tools-plugin.ts"], "capabilities": ["tools"] },
    { "paths": ["./hooks-plugin.ts"], "capabilities": ["hooks"] }
  ]
}
```

Each entry file should `export default` its own plugin object.

## Testing Your Plugin

### Unit Tests

The plugin object is plain data. Drive `setup()` against a minimal context and exercise tools directly:

```typescript
import plugin from "../my-plugin"

const tools: unknown[] = []
const api = {
  registerTool: (t: unknown) => tools.push(t),
  registerCommand: () => {},
  registerRule: () => {},
  registerMessageBuilder: () => {},
  registerProvider: () => {},
  registerAutomationEventType: () => {},
}
await plugin.setup?.(api as never, {
  workspaceInfo: { rootPath: "/tmp/fake-workspace" },
})

// Now `tools` contains the registered tools -- call tool.execute(input, ctx)
```

### End-to-End with runDemo()

Add a `runDemo()` in your plugin file (see the single-file template above) that boots a real `ClineCore` session:

```bash
ANTHROPIC_API_KEY=sk-... bun run my-plugin.ts
```

### CLI Smoke Test

```bash
mkdir -p .cline/plugins
cp my-plugin.ts .cline/plugins/
cline -i "trigger something that exercises the plugin"
```

For packages:

```bash
cline plugin install ./my-cline-plugin
cline -i "..."
```

If the plugin fails validation or setup, the CLI prints a clear error and continues without it.

## Common Gotchas

- "capabilities must be a non-empty array" -- you forgot `manifest.capabilities`, or it's `[]`.
- "registerRule requires the 'rules' capability" -- capability/handler drift. Add `"rules"` to capabilities, or stop calling `registerRule`.
- Tool not visible to the model -- check `enableTools: true` on the session config, and that you're declaring `"tools"` in capabilities.
- `ctx.workspaceInfo` is undefined in SDK tests -- the host didn't pass `extensionContext.workspace`. In SDK code, set it explicitly (see the ClineCore loading example above).
- State leaking across sessions -- module-level variables are shared across sessions in the same process. Key by `ctx.session?.sessionId` if your host runs multiple sessions concurrently.
- `afterRun` firing on aborts -- guard with `if (result.status !== "completed") return`.
- Heavy work in `setup()` -- `setup()` blocks session start. Defer expensive work into the first tool call or `beforeRun`.
- Importing host internals -- only import from `@cline/core`. Reaching into host-specific packages (e.g. CLI internals) will break in non-CLI hosts.
- Sandboxed plugins and `telemetry` -- telemetry is process-local. Feature-detect `ctx.telemetry` and expect it to be undefined in sandboxed plugin processes.
- Resolving bundled assets -- use `import.meta.url` + `fileURLToPath` to find files inside your package; never `process.cwd()`. For workspace paths, do the opposite: use `ctx.workspaceInfo?.rootPath`, never `import.meta.url`.
- Plugin name collisions -- `name` must be unique within a session. If two plugins share a name, validation fails. Namespace by package (`my-org-redactor`, not `redactor`).

## Decision Guide -- Which Extension Point?

| You want to... | Use |
|----------------|-----|
| Give the model a new capability | `registerTool` |
| Add a slash command in chat surfaces | `registerCommand` |
| Inject text into the system prompt | `registerRule` |
| Rewrite messages before they hit the provider | `registerMessageBuilder` |
| Add a custom model provider | `registerProvider` |
| Emit normalized cron/webhook events | `registerAutomationEventType` + `ctx.automation` |
| Observe or steer the agent loop | `hooks.*` |
| Block a dangerous tool call | `hooks.beforeTool` returning `{ stop: true }` |
| Notify on completion | `hooks.afterRun` (gate on `status === "completed"`) |
| Tweak each model request | `hooks.beforeModel` |
| Stream events to a UI | `hooks.onEvent` |
| Ship reusable templates with the plugin | Bundle assets next to `index.ts`, resolve via `import.meta.url` |
| Let users override defaults globally or per-project | Three-tier lookup: bundled / global / project |

## Pre-Ship Checklist

- `manifest.capabilities` is a non-empty array.
- Every `api.register*` call has a matching capability declared.
- If `hooks` is present, `"hooks"` is in `capabilities`.
- `ctx.workspaceInfo?.rootPath` is used for workspace paths (not `process.cwd()`).
- Optional `ctx` fields are feature-detected.
- Tool names are snake_case verbs; descriptions are written for the model.
- Tool inputs have JSON Schema with `required` set.
- `afterRun` handlers gate on `result.status === "completed"` if they only want successes.
- State that must not leak between concurrent sessions is keyed by `ctx.session?.sessionId`.
- (Package) `package.json` has `type: "module"`, `cline.plugins`, and `@cline/core` as an optional peer dep.
- (Package) Bundled assets resolved via `import.meta.url`, not `process.cwd()`.
- Smoke test: drop the plugin into `.cline/plugins/` (or `cline plugin install`), run `cline -i "..."`, watch it work.

## Plugin Examples from SDK

The SDK repo includes these example plugins:

| Plugin | Description |
|--------|-------------|
| `weather-metrics.ts` | Tool registration + lifecycle metrics |
| `mac-notify.ts` | macOS Notification Center alerts |
| `custom-compaction.ts` | Custom message compaction via message builders |
| `background-terminal.ts` | Detached shell job management |
| `automation-events.ts` | Plugin-emitted automation events |
| `gitignore-read-files-guard.ts` | File access policy enforcement via beforeTool |
| `web-search.ts` | Web search via Exa API |
| `typescript-lsp/` | TypeScript Language Service tools (plugin package) |
| `agents-squad/` | Multi-agent team orchestration (plugin package) |

## See Also

- `../tools/REFERENCE.md` - Tool creation
- `../events/REFERENCE.md` - Event system
- `../agent/REFERENCE.md` - Using plugins with Agent
- `../clinecore/REFERENCE.md` - Using plugins with ClineCore
