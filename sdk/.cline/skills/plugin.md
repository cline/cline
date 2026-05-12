---
name: cline-plugin
description: Self-contained guide to designing, building, packaging, and distributing a plugin for any Cline-based agent (CLI, VS Code, Kanban, JetBrains, custom SDK hosts). Covers both single-file plugins and full plugin packages.
---

# Authoring a Cline Agent Plugin

A **Cline plugin** is a TypeScript module that extends any agent built on the Cline Core SDK. The same plugin runs in the Cline CLI, the VS Code and JetBrains extensions, the Kanban host, and any custom app built on `@cline/core` — write it once, every host gets the new behavior.

A plugin can:

- **Register tools** the model can call (the most common use).
- **Hook into the agent loop** before/after runs, model calls, and tool calls.
- **Rewrite provider messages** before they hit the model (custom compaction, redaction, context shaping).
- **Register slash commands**, **prompt rules**, **providers**, and **automation event types**.

A plugin ships in one of two shapes:

1. **Single-file plugin** — one `.ts` file that exports a default plugin object. Drop it in a discovery folder and it's loaded.
2. **Plugin package** — a directory with `package.json`, npm dependencies, and (optionally) bundled assets like markdown templates. Installable via `cline plugin install`.

Both shapes use the same plugin API. The package form just adds dependency management and asset bundling.

This guide is self-contained. By the end of it, you'll be able to build either kind from scratch.

---

## 1. The mental model

When the host starts a session, it builds a registry of plugins and runs four phases:

1. **resolve** — collect the plugin objects.
2. **validate** — check each plugin's `manifest`. Capabilities must be non-empty; declared hook stages must have matching handlers; if `hooks` is present, `"hooks"` must be in `capabilities`.
3. **setup** — call each plugin's `setup(api, ctx)` once. This is where you `registerTool`, `registerCommand`, etc.
4. **activate** — registry is frozen, the agent loop starts, and your hooks/tools are live.

Two invariants the registry enforces:

- **Every contribution requires a matching capability.** Calling `api.registerRule(...)` without `"rules"` in `manifest.capabilities` throws.
- **Capabilities and handlers must agree.** Declaring `"hooks"` without a `hooks` object, or vice versa, fails validation.

After validation, registration is one-shot — there's no dynamic register/unregister during the session.

---

## 2. The smallest working plugin

```ts
import type { AgentPlugin } from "@cline/core";
import { createTool } from "@cline/core";

const plugin: AgentPlugin = {
  name: "hello-plugin",                     // required, unique within a session
  manifest: {
    capabilities: ["tools"],                // declares what setup() will register
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
          return { greeting: `Hello, ${name}!` };
        },
      }),
    );
  },
};

export default plugin;
```

That's a complete plugin. The agent will see `say_hello` as a callable tool.

---

## 3. The manifest

```ts
manifest: {
  capabilities: ["tools", "hooks"],   // required — non-empty array
  paths?: string[],                   // optional — multi-entry packages
  providerIds?: string[],             // optional — provider plugins
  modelIds?: string[],                // optional — model plugins
}
```

| Field          | When to use                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `capabilities` | Always. Lists what the plugin contributes; gates the corresponding `api.register*` methods.             |
| `paths`        | Only inside a `package.json` `cline.plugins` entry — when one package exposes multiple plugin entry points. |
| `providerIds`  | When `capabilities` includes `"providers"` — declares which provider IDs you register.                  |
| `modelIds`     | When you contribute models tied to specific IDs.                                                        |

### The complete capability list

| Capability         | What it unlocks in `api`                                              |
| ------------------ | --------------------------------------------------------------------- |
| `tools`            | `api.registerTool()`                                                  |
| `commands`         | `api.registerCommand()` (slash commands in chat surfaces)             |
| `rules`            | `api.registerRule()` (string injected into the system prompt)         |
| `messageBuilders`  | `api.registerMessageBuilder()` (rewrites provider-bound messages)     |
| `providers`        | `api.registerProvider()` (e.g. a custom model provider)               |
| `automationEvents` | `api.registerAutomationEventType()` and `ctx.automation?.ingestEvent()` |
| `hooks`            | The runtime `hooks` object on the plugin (lifecycle callbacks)        |

You declare any combination — most real plugins need 1–3 capabilities.

---

## 4. `setup(api, ctx)` — the registration phase

`setup()` runs **once per session** before the agent loop starts. Everything you register here is frozen for the lifetime of the session.

### 4.1 The `api` object

Each `register*` method requires the matching capability in your manifest:

```ts
api.registerTool(tool);                              // requires "tools"
api.registerCommand({ name, description, handler }); // requires "commands"
api.registerRule({ id, content, source });           // requires "rules"
api.registerMessageBuilder({ name, build });         // requires "messageBuilders"
api.registerProvider({ name, description });         // requires "providers"
api.registerAutomationEventType({ eventType, source, /* ... */ }); // requires "automationEvents"
```

### 4.2 The `ctx` object — host-provided session context

The second argument carries everything the host knows about the current session. **All fields are optional**, so feature-detect before using them — the same plugin must work in hosts that supply less context (unit tests, sandboxed plugin processes).

```ts
ctx.session?.sessionId       // string — stable core session id
ctx.client?.name             // host: "cline-cli", "cline-vscode", etc.
ctx.user                     // authenticated user/org info, when available
ctx.workspaceInfo            // { rootPath, hint, latestGitBranchName,
                             //   latestGitCommitHash, associatedRemoteUrls }
ctx.automation?.ingestEvent  // emit normalized automation events
ctx.logger?.log              // structured logger scoped to this plugin
ctx.telemetry                // ITelemetryService — only present in-process
```

**Two big rules about `ctx.workspaceInfo`:**

1. **Always prefer `ctx.workspaceInfo?.rootPath` over `process.cwd()`.** The CLI may have been launched with `--cwd` without calling `chdir`, and VS Code workspaces don't share a single CWD. `workspaceInfo` is sourced from the session config and is always correct.
2. **Don't use `import.meta.url` tricks to find "the workspace".** That gives you the plugin's own location, not the user's project.

### 4.3 Persisting state across hooks

`setup()` runs first; hooks fire later. The simplest way to share state is module-level variables in your plugin file:

```ts
let sessionWorkspaceRoot: string | undefined;
let sessionBranch: string | undefined;

const plugin: AgentPlugin = {
  name: "metrics",
  manifest: { capabilities: ["hooks"] },
  setup(api, ctx) {
    sessionWorkspaceRoot = ctx.workspaceInfo?.rootPath;
    sessionBranch = ctx.workspaceInfo?.latestGitBranchName;
  },
  hooks: {
    beforeTool({ toolCall, input }) {
      if (sessionBranch === "main" && toolCall.toolName === "run_commands") {
        // Inspect input, optionally block.
      }
      return undefined;
    },
  },
};
```

A single Node process may host multiple sessions concurrently. If your plugin will run in a multi-session host, key your state by `ctx.session?.sessionId` instead of using module-level singletons:

```ts
const stateBySession = new Map<string, MyState>();
setup(api, ctx) {
  const id = ctx.session?.sessionId;
  if (id) stateBySession.set(id, /* ... */);
}
```

---

## 5. Tools — `api.registerTool`

Tools are how plugins give the agent new capabilities. Use the `createTool()` helper from `@cline/core`:

```ts
import { createTool } from "@cline/core";

api.registerTool(
  createTool({
    name: "get_weather",                // visible to the model
    description: "Get current weather for a city.",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "The city name" },
      },
      required: ["city"],
    },
    async execute(input, context) {
      const { city } = input as { city: string };
      // context.sessionId, context.conversationId, context.cwd are available
      return { city, temperature: "72°F", condition: "sunny" };
    },
  }),
);
```

Guidelines for good tools:

- **Names are snake_case verbs** — `goto_definition`, `start_background_command`.
- **Descriptions are written for the model**, not for humans. Include when to use the tool, what inputs mean, and what the output looks like.
- **Inputs are JSON Schema.** Mark `required` fields explicitly. Constrain enums where possible.
- **Return JSON-serializable values** — strings, numbers, plain objects, arrays. The host serializes results before passing them back to the model.
- **Throw on invalid input or hard failure.** The runtime turns thrown errors into tool error results the model can recover from.
- **Keep tools focused.** A `start / get / delete` triplet of small tools beats one mega-tool with a `mode` enum.

---

## 6. Runtime hooks — `hooks: { ... }`

Runtime hooks are typed in-process callbacks on the same hook layer the runtime uses internally. They run inside the agent loop with full type information — no IPC, no JSON marshaling.

Declare `"hooks"` in `manifest.capabilities`, then add a `hooks` property:

```ts
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
};
```

### 6.1 The seven hooks

| Hook          | Fires                                                      | Can stop the loop? | Common uses                                            |
| ------------- | ---------------------------------------------------------- | ------------------ | ------------------------------------------------------ |
| `beforeRun`   | Before the runtime loop starts (one user turn)             | Yes                | Greet, log, attach session metadata                    |
| `afterRun`    | After the runtime loop finishes (success, abort, or fail)  | No                 | Notifications, metrics, persistent logs                |
| `beforeModel` | Before each model request                                  | Yes (mutate req)   | Inject context, last-mile prompt edits                 |
| `afterModel`  | After each model response, before tool execution           | Yes                | Block based on model output                            |
| `beforeTool`  | Before each tool execution                                 | Yes (`{ stop }`)   | Audit, redact, block dangerous tools                   |
| `afterTool`   | After each tool execution                                  | Can replace result | Post-process, redact secrets in tool output            |
| `onEvent`     | On every `AgentRuntimeEvent` emitted by the runtime        | No                 | Streaming UIs, telemetry pipes                         |

### 6.2 Stopping the loop from a hook

Several hooks return an optional control object. The most common pattern is `beforeTool` blocking a destructive tool call:

```ts
beforeTool({ toolCall, input }) {
  if (toolCall.toolName === "run_commands") {
    const { commands } = input as { commands?: string[] };
    if (sessionBranch === "main" && commands?.some(c => c.startsWith("git push"))) {
      return { stop: true, reason: "Blocked git push on protected branch" };
    }
  }
  return undefined;  // explicit "continue"
}
```

Returning `undefined` (or omitting `return`) lets execution continue normally.

### 6.3 `afterRun` semantics

`afterRun` fires for **every** terminal status — `completed`, `aborted`, `failed`. If you only want to act on success:

```ts
afterRun({ result }) {
  if (result.status !== "completed") return;
  // notify, log success metrics, etc.
}
```

### 6.4 Plugin hooks vs file hooks

The runtime supports two hook systems:

- **File hooks** — external scripts in `.cline/hooks/` invoked with serialized JSON. Right for user/workspace-specific scripts that don't ship with code.
- **Plugin runtime hooks** — typed in-process callbacks. Right when the behavior belongs to a reusable extension and needs typed access to the runtime.

Core adapts file hooks onto the runtime hook layer, so you don't need both. If you're shipping a plugin, write it as runtime hooks.

---

## 7. Message builders — `api.registerMessageBuilder`

Message builders rewrite the **provider-bound message list** before the model call. They run after runtime messages are converted into SDK message blocks but **before** core's built-in safety builder, which always has the final say on provider-safe truncation.

Use them for:

- Custom compaction policies (replace middle history with a summary).
- Redacting PII or secrets before they reach the provider.
- Reshaping context for a specific model's strengths.

```ts
api.registerMessageBuilder({
  name: "summarize-middle-history",
  build(messages) {
    if (estimateTokens(messages) < THRESHOLD) return messages;
    return [...prefix, summary, ...recent];
  },
});
```

Multiple builders run in registration order; the output of one is the input of the next.

**When to use `beforeModel` instead.** Reach for the `beforeModel` hook only if you need the runtime snapshot or want to mutate the request object itself. Pure message rewrites belong in a builder.

---

## 8. Automation events — `api.registerAutomationEventType` + `ctx.automation`

Plugins can declare normalized event types and emit them into Cline automation. Hosts that don't have automation enabled simply ignore both — your plugin should feature-detect `ctx.automation`.

```ts
manifest: { capabilities: ["automationEvents"] },

setup(api, ctx) {
  api.registerAutomationEventType({
    eventType: "github.pull_request.opened",
    source: "github",
    description: "A new GitHub PR was opened",
    attributesSchema: { /* JSON Schema for envelope.attributes */ },
  });

  if (!ctx.automation) return;  // host has no automation
  ctx.automation.ingestEvent({
    eventId: "pr-1234",
    eventType: "github.pull_request.opened",
    source: "github",
    subject: "owner/repo#1234",
    occurredAt: new Date().toISOString(),
    attributes: { /* ... */ },
  });
}
```

---

## 9. Loading a plugin

There are three ways a plugin gets into a session:

### 9.1 Auto-discovery (CLI)

The CLI scans these directories on startup:

- `<workspace>/.cline/plugins/` — project-scoped plugins (committed or gitignored).
- `~/.cline/plugins/` — user-scoped plugins.
- The system "Plugins" folder — host-managed installs.

Drop a `.ts` or `.js` file in, run `cline`, done:

```bash
mkdir -p .cline/plugins
cp my-plugin.ts .cline/plugins/
cline -i "do the thing my plugin enables"
```

### 9.2 Explicit `extensions: [...]` in SDK config

When you build your own host with `ClineCore`, pass the plugin object directly:

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
    // Required for ctx.workspaceInfo to be populated:
    extensionContext: {
      workspace: { rootPath: process.cwd(), cwd: process.cwd() },
    },
  },
  prompt: "...",
  interactive: false,
});
```

### 9.3 `pluginPaths: [...]` for directory-based plugins

When the plugin is a directory with `package.json`, point `pluginPaths` at the directory. The loader reads `package.json` and finds entry points from the `cline.plugins` field:

```ts
config: {
  // ...
  pluginPaths: ["./path/to/my-plugin-package"],
}
```

Or install one with the CLI:

```bash
cline plugin install ./path/to/my-plugin-package
cline plugin install @scope/my-cline-plugin       # from npm
cline plugin install --git github.com/owner/repo  # from git
```

---

## 10. Single-file plugin — full template

This is the full shape for a single-file plugin. Save as `my-plugin.ts`, drop in `.cline/plugins/`.

```ts
/**
 * My Cline Plugin
 *
 * What it does: <one paragraph, written for users>.
 *
 * CLI usage:
 *   mkdir -p .cline/plugins
 *   cp my-plugin.ts .cline/plugins/
 *   cline -i "trigger something the plugin enables"
 *
 * Direct demo:
 *   ANTHROPIC_API_KEY=sk-... bun run my-plugin.ts
 */

import { type AgentPlugin, ClineCore, createTool } from "@cline/core";

let sessionRoot: string | undefined;

const plugin: AgentPlugin = {
  name: "my-plugin",
  manifest: {
    capabilities: ["tools", "hooks"],
  },

  setup(api, ctx) {
    sessionRoot = ctx.workspaceInfo?.rootPath;

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
          const { target } = input as { target: string };
          return { ok: true, target, root: sessionRoot };
        },
      }),
    );
  },

  hooks: {
    beforeRun() {
      console.log("[my-plugin] run started");
    },
    afterRun({ result }) {
      if (result.status !== "completed") return;
      console.log(`[my-plugin] done in ${result.iterations} iteration(s)`);
    },
  },
};

// Optional: a runnable demo so users can `bun run` this file directly.
async function runDemo(): Promise<void> {
  const host = await ClineCore.create({ backendMode: "local" });
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
    });
    console.log(result.result?.text ?? "");
  } finally {
    await host.dispose();
  }
}

if (import.meta.main) {
  await runDemo();
}

export { plugin, runDemo };
export default plugin;
```

That's the entire shape. Copy it, rename the tool, swap in your logic.

---

## 11. Plugin package — full walkthrough

A **plugin package** is a directory with a `package.json`. Use it when you need any of:

- npm dependencies (`zod`, `yaml`, `typescript`, etc.)
- multiple plugin entry points from one package
- bundled assets (markdown templates, agent definitions, schemas, fixtures)
- a way to ship and version the plugin via npm or git

The package is still just a normal npm package — what makes it a plugin is the `cline.plugins` field in `package.json`.

### 11.1 Layout

A typical package looks like:

```
my-cline-plugin/
├── package.json
├── tsconfig.json          (optional — for local typechecking)
├── index.ts               (the plugin entry point)
├── README.md              (user-facing docs)
└── assets/                (optional — bundled content)
    ├── templates/
    │   └── greeting.md
    └── schemas/
        └── input.json
```

For larger plugins, you can also organize by feature:

```
my-cline-plugin/
├── package.json
├── index.ts
├── tools/
│   ├── do-thing.ts
│   └── read-thing.ts
├── hooks/
│   └── audit.ts
├── lib/
│   └── helpers.ts
└── assets/
    └── ...
```

### 11.2 `package.json` — the discovery contract

```json
{
  "name": "my-cline-plugin",
  "version": "0.1.0",
  "private": true,
  "description": "What this plugin does, in one sentence.",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf node_modules dist"
  },
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

Field-by-field:

- **`type: "module"`** — required. Cline plugins are ES modules.
- **`exports`** — points npm consumers at the entry. For TypeScript-source plugins loaded by Cline at runtime, you can export `./index.ts` directly; the loader handles TS.
- **`cline.plugins`** — the discovery contract. An array of entries, each with:
  - `paths` — entry files relative to the package root. For multiple plugin objects from one package, list all entries.
  - `capabilities` — pre-declared capabilities, validated by the loader before importing the entry.
- **`peerDependencies` for `@cline/core`** — the host already provides `@cline/core`. Marking it a peer dep avoids version drift; marking it optional lets users typecheck the plugin in isolation without forcing a `@cline/core` install.
- **`dependencies`** — your own deps (parsers, schema libraries, SDKs you wrap).

### 11.3 `tsconfig.json` (optional)

For local typechecking only:

```json
{
  "extends": "../../tsconfig.json",
  "include": ["index.ts"]
}
```

If your plugin lives outside a monorepo, a minimal standalone `tsconfig.json` works too:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["index.ts"]
}
```

### 11.4 `index.ts` — package entry

The same plugin shape as the single-file version, just inside a package:

```ts
import { type AgentPlugin, createTool } from "@cline/core";
import { z } from "zod";

const InputSchema = z.object({
  target: z.string().min(1),
});

const plugin: AgentPlugin = {
  name: "my-cline-plugin",
  manifest: {
    capabilities: ["tools"],
  },
  setup(api, ctx) {
    api.registerTool(
      createTool({
        name: "do_thing",
        description: "Do the thing.",
        inputSchema: {
          type: "object",
          properties: { target: { type: "string" } },
          required: ["target"],
        },
        async execute(input) {
          const { target } = InputSchema.parse(input);
          return { ok: true, target };
        },
      }),
    );
  },
};

export default plugin;
```

### 11.5 Bundling assets

Anything next to `index.ts` ships with the package. Resolve asset paths with `import.meta.url`, **not** `process.cwd()`:

```ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(MODULE_DIR, "assets", "templates");

function loadTemplate(name: string): string | undefined {
  const path = join(TEMPLATES_DIR, `${name}.md`);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}
```

This is the only place `import.meta.url` is appropriate in a plugin — locating files **inside the plugin package**. For workspace paths, always use `ctx.workspaceInfo?.rootPath`.

### 11.6 The override pattern (bundled / global / project)

A package can ship default assets and let users override them with their own. The convention used across Cline plugins is a three-tier lookup, last write wins by `name`:

1. **bundled** — files inside the plugin package (defaults shipped with the plugin).
2. **global** — files under `~/.cline/data/settings/<kind>/` (user overrides).
3. **project** — files under `<workspace>/.cline/<kind>/` (project overrides).

Example: a plugin that supports user-defined "presets" via markdown files with YAML frontmatter:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const BUNDLED_DIR = join(MODULE_DIR, "presets");

function resolveDataDir(): string {
  return process.env.CLINE_DATA_DIR ??
    join(process.env.HOME ?? "~", ".cline", "data");
}

function readPresets(workspaceRoot: string) {
  const sources = [
    { dir: BUNDLED_DIR, source: "bundled" as const },
    { dir: join(resolveDataDir(), "settings", "presets"), source: "global" as const },
    { dir: join(workspaceRoot, ".cline", "presets"), source: "project" as const },
  ];
  const presets = new Map<string, { name: string; body: string; source: string }>();
  for (const { dir, source } of sources) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const raw = readFileSync(join(dir, entry.name), "utf8");
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      const data = match ? YAML.parse(match[1] ?? "") ?? {} : {};
      const body = (match ? match[2] : raw).trim();
      const name = data?.name ?? entry.name.replace(/\.md$/, "");
      // Project overrides global overrides bundled — last write wins.
      presets.set(name, { name, body, source });
    }
  }
  return [...presets.values()];
}
```

This pattern lets users:

- Use the plugin out of the box (bundled defaults).
- Customize globally for all projects (drop a file in `~/.cline/data/settings/<kind>/`).
- Override per-project (drop a file in `<workspace>/.cline/<kind>/`).

### 11.7 Multiple plugin entries in one package

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

### 11.8 Installing the package

Once the package is on disk, on npm, or in a git repo, users install it with:

```bash
cline plugin install ./my-cline-plugin              # local path
cline plugin install @scope/my-cline-plugin          # npm
cline plugin install --git github.com/owner/repo     # git
```

The CLI installs into `<workspace>/.cline/plugins/.installs/` (or `~/.cline/plugins/.installs/`) and auto-discovers it on the next session.

For SDK consumers, point `pluginPaths` at the package directory directly (see §9.3).

---

## 12. Testing your plugin

### 12.1 Unit tests

The plugin object is plain data. You can drive `setup()` against a minimal context and exercise tools directly:

```ts
import plugin from "../my-plugin";

const tools: unknown[] = [];
const api = {
  registerTool: (t: unknown) => tools.push(t),
  registerCommand: () => {},
  registerRule: () => {},
  registerMessageBuilder: () => {},
  registerProvider: () => {},
  registerAutomationEventType: () => {},
};
await plugin.setup?.(api as never, {
  workspaceInfo: { rootPath: "/tmp/fake-workspace" },
});

// Now `tools` contains the registered tools — call tool.execute(input, ctx).
```

For higher fidelity, build a real registry (`new ContributionRegistry({ extensions: [plugin] })`) and call `initialize()` — that exercises validation too.

### 12.2 End-to-end with a `runDemo()`

Add a `runDemo()` in your plugin file (see §10) that boots a real `ClineCore` session against `ANTHROPIC_API_KEY`:

```bash
ANTHROPIC_API_KEY=sk-... bun run my-plugin.ts
```

This is the fastest way to verify the plugin works end-to-end.

### 12.3 CLI smoke test

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

---

## 13. Common gotchas

- **"capabilities must be a non-empty array"** — you forgot `manifest.capabilities`, or it's `[]`.
- **"registerRule requires the 'rules' capability"** — capability/handler drift. Add `"rules"` to capabilities, or stop calling `registerRule`.
- **Tool not visible to the model** — check `enableTools: true` on the session config, and that you're declaring `"tools"` in capabilities.
- **`ctx.workspaceInfo` is undefined in SDK tests** — the host didn't pass `extensionContext.workspace`. In SDK code, set it explicitly (see §9.2).
- **State leaking across sessions** — module-level variables are shared across sessions in the same process. Key by `ctx.session?.sessionId` if your host runs multiple sessions concurrently.
- **`afterRun` firing on aborts** — guard with `if (result.status !== "completed") return;`.
- **Heavy work in `setup()`** — `setup()` blocks session start. Defer expensive work into the first tool call or `beforeRun`.
- **Importing host internals** — only import from `@cline/core`. Reaching into host-specific packages (e.g. CLI internals) will break in non-CLI hosts.
- **Sandboxed plugins and `telemetry`** — telemetry is process-local. Feature-detect `ctx.telemetry` and expect it to be undefined in sandboxed plugin processes.
- **Resolving bundled assets** — use `import.meta.url` + `fileURLToPath` to find files inside your package; never `process.cwd()`. For workspace paths, do the opposite: use `ctx.workspaceInfo?.rootPath`, never `import.meta.url`.
- **Plugin name collisions** — `name` must be unique within a session. If two plugins share a name, validation fails. Namespace by package (`my-org-redactor`, not `redactor`).

---

## 14. Decision guide — which extension point?

| You want to…                                                | Use                                              |
| ----------------------------------------------------------- | ------------------------------------------------ |
| Give the model a new capability                             | `registerTool`                                   |
| Add a slash command in chat surfaces                        | `registerCommand`                                |
| Inject text into the system prompt                          | `registerRule`                                   |
| Rewrite messages before they hit the provider               | `registerMessageBuilder`                         |
| Add a custom model provider                                 | `registerProvider`                               |
| Emit normalized cron/webhook events                         | `registerAutomationEventType` + `ctx.automation` |
| Observe or steer the agent loop                             | `hooks.*`                                        |
| Block a dangerous tool call                                 | `hooks.beforeTool` returning `{ stop: true }`    |
| Notify on completion                                        | `hooks.afterRun` (gate on `status === "completed"`) |
| Tweak each model request                                    | `hooks.beforeModel`                              |
| Stream events to a UI                                       | `hooks.onEvent`                                  |
| Ship reusable templates with the plugin                     | Bundle assets next to `index.ts`, resolve via `import.meta.url` |
| Let users override defaults globally or per-project         | Three-tier lookup: bundled / global / project    |

---

## 15. Quick checklist before you ship

- [ ] `manifest.capabilities` is a non-empty array.
- [ ] Every `api.register*` call has a matching capability declared.
- [ ] If `hooks` is present, `"hooks"` is in `capabilities`.
- [ ] `ctx.workspaceInfo?.rootPath` is used for workspace paths (not `process.cwd()`).
- [ ] Optional `ctx` fields are feature-detected.
- [ ] Tool names are snake_case verbs; descriptions are written for the model.
- [ ] Tool inputs have JSON Schema with `required` set.
- [ ] `afterRun` handlers gate on `result.status === "completed"` if they only want successes.
- [ ] State that must not leak between concurrent sessions is keyed by `ctx.session?.sessionId`.
- [ ] (Package) `package.json` has `type: "module"`, `cline.plugins`, and `@cline/core` as an optional peer dep.
- [ ] (Package) Bundled assets resolved via `import.meta.url`, not `process.cwd()`.
- [ ] Smoke test: drop the plugin into `.cline/plugins/` (or `cline plugin install`), run `cline -i "..."`, watch it work.

When in doubt, write a tiny tool, get it to fire end-to-end, then grow it.
