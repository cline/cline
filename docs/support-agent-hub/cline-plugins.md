# Cline Plugins (Installable Plugins That Extend the Agent)

> Support-agent reference. Grounded on `main` @ `025baa8fb76d9bdb8a351177bc51b6c2721e18fa` (github.com/cline/cline).

## What they are

A Cline plugin is a **TypeScript/JavaScript module** that extends any agent built on the Cline SDK. Per `.agents/skills/cline-sdk/references/plugins/REFERENCE.md`: "The same plugin runs in the Cline CLI, VS Code and JetBrains extensions, and any custom app built on `@cline/core`." This is the second of the two plugin lanes (the other is the portable [Agent Plugins](./agent-plugins.md) lane; the lane split is documented in `sdk/packages/shared/src/storage/paths.ts`).

A plugin can register tools, hook into the agent loop, rewrite provider-bound messages, and register slash commands, system-prompt rules, providers, MCP servers, and automation event types.

## The plugin API

The canonical type is `AgentExtension` (`sdk/packages/shared/src/agents/types.ts`), exported publicly as `AgentPlugin` from `@cline/core`/`@cline/sdk` (`sdk/packages/core/src/index.ts`). Shape:

```typescript
const plugin: AgentPlugin = {
  name: "my-plugin",                                // unique per session
  manifest: { capabilities: ["tools", "hooks"] },  // required, non-empty
  setup(api, ctx) { api.registerTool(...) },        // one-shot registration phase
  hooks: { beforeRun() {}, beforeTool() {}, afterRun() {} },
}
export default plugin
```

- **Capabilities** (`AgentExtensionCapability`): `hooks`, `tools`, `commands`, `rules`, `skills`, `messageBuilders`, `providers`, `automationEvents`, `mcp`. Every `api.register*` call requires the matching capability in the manifest, and declared capabilities must have matching handlers (validation fails otherwise).
- **`setup(api, ctx)` registration methods:** `registerTool`, `registerCommand`, `registerRule`, `registerMessageBuilder`, `registerProvider`, `registerAutomationEventType`, `registerMcpServer` (`sdk/packages/shared/src/extensions/contribution-registry.ts`).
- **Runtime hooks** (`AgentRuntimeHooks`, `sdk/packages/shared/src/agent.ts`): `beforeRun`, `afterRun`, `beforeModel`, `afterModel`, `beforeTool`, `afterTool`, `onEvent`. `beforeTool` can block a call by returning `{ stop: true, reason }`; `afterTool` can replace the result; `afterRun` fires for every terminal status (`completed`, `aborted`, `failed`).
- **Registry lifecycle:** resolve → validate → setup → activate; registration is one-shot per session (skill plugins reference).
- **`ctx`** carries host-provided session context: `ctx.session?.sessionId`, `ctx.client?.name` (e.g. `"cline-cli"`, `"cline-vscode"`), `ctx.workspaceInfo` (`rootPath`, git branch/commit, remote URLs), `ctx.automation?.ingestEvent`, `ctx.logger`, `ctx.telemetry`. Plugins should use `ctx.workspaceInfo?.rootPath` for workspace paths, never `process.cwd()` or `import.meta.url`.

## Two shapes

1. **Single-file plugin** — one `.ts`/`.js` file exporting a default plugin object; drop it in a discovery folder. Allowed extensions come from `PLUGIN_FILE_EXTENSIONS` (`sdk/packages/shared/src/extensions/plugin.ts`).
2. **Plugin package** — a directory with a `package.json` that declares the discovery contract:

```json
"cline": { "plugins": [{ "paths": ["./index.ts"], "capabilities": ["tools", "hooks"] }] }
```

Packages must be ES modules (`"type": "module"`) and should mark `@cline/core` as an optional peer dependency (skill plugins reference).

## Discovery and installation

Discovery paths (`resolvePluginConfigSearchPaths` in `sdk/packages/shared/src/storage/paths.ts`):

- `<workspace>/.cline/plugins/` — project-scoped
- `~/.cline/plugins/` — user-scoped (root overridable via `CLINE_DIR`)
- `~/Documents/Cline/Plugins` — documents extension path

CLI commands (`apps/cli/src/main.ts`, "Manage Cline Plugins"; implementation `apps/cli/src/commands/plugin.ts` → `installPlugin`/`uninstallPlugin` in `sdk/packages/core/src/services/plugin-install.ts` / `plugin-uninstall.ts`):

```bash
cline plugin install ./path/to/plugin        # local path
cline plugin install @scope/my-cline-plugin  # npm (--npm)
cline plugin install --git github.com/owner/repo
cline plugin install <slug>                  # official collection (github.com/cline/plugins)
cline plugin uninstall <name>                # aliases: remove, rm
```

Installs land under `~/.cline/plugins/_installed/{npm|git|official|...}` (or `<cwd>/.cline/plugins` with `--cwd`).

SDK hosts can also pass plugins directly: `config.extensions: [pluginObject]` or `config.pluginPaths: ["./plugin-package-dir"]`.

## Sandboxing

Directory-based plugins run in sandboxed subprocesses managed by core (`sdk/packages/core/src/extensions/plugin/`). Per `sdk/ARCHITECTURE.md`: sandboxes are reclaimed after 30 minutes idle (configurable via `PluginSandboxOptions.idleTimeoutMs` or `CLINE_PLUGIN_IDLE_TIMEOUT_MS`) and transparently recreated on the next call; in-process plugin state is ephemeral across idle eviction. `ctx.telemetry` is process-local and undefined in sandboxed plugin processes — feature-detect it.

## Plugin hooks vs file hooks

The runtime supports two hook systems (skill plugins reference): **file hooks** — external scripts in `.cline/hooks/` invoked with serialized JSON — and **plugin runtime hooks** — typed in-process callbacks. Core adapts file hooks onto the same runtime hook layer. Reusable extensions should ship as plugin runtime hooks; user/workspace-local scripts fit file hooks.

## Example plugins (`sdk/examples/plugins/`)

`weather-metrics.ts` (tools + lifecycle metrics), `telemetry.ts`, `mac-notify.ts` (afterRun notifications), `custom-compaction.ts` (message builders), `background-terminal.ts` (detached shell jobs), `automation-events.ts`, `gitignore-read-files-guard.ts` and `env-blocker.ts` (beforeTool policies), `web-search.ts` (Exa), `openrouter-provider.ts` (registerProvider), `typescript-lsp/` (plugin package with TS language-service tools), `agents-squad/` (multi-agent orchestration package). See `sdk/examples/plugins/README.md`.

## Common gotchas (from the skill reference)

- "capabilities must be a non-empty array" → missing/empty `manifest.capabilities`.
- "registerRule requires the 'rules' capability" → capability/handler drift.
- Tool not visible to the model → check `enableTools: true` and `"tools"` capability.
- If a plugin has both `plugin.json` at its root, it is treated as an Agent Plugin and Cline-module scanning stops (`isAgentPluginDirectory` in the core loader) — the lanes are mutually exclusive per directory.
- Plugin name collisions fail validation; namespace names by org/package.
- If a plugin fails validation or setup, the CLI prints an error and continues without it.

## Known gaps on main

- `apps/cli/README.md` mentions plugins only in passing; detailed authoring/install docs live in the SDK skill (`.agents/skills/cline-sdk/references/plugins/REFERENCE.md`) and `sdk/examples/plugins/README.md`.
- The official plugin collection is the separate repo `github.com/cline/plugins` (referenced from `sdk/packages/core/src/services/plugin-install.ts`); there is no in-repo catalog.
