# Agent Plugins (Portable, agent-plugins.org)

> Support-agent reference. Grounded on `main` @ `025baa8fb76d9bdb8a351177bc51b6c2721e18fa` (github.com/cline/cline).

## What they are

"Agent Plugins" are **portable, vendor-neutral plugin packages** following the Agent Plugins v1 specification (agent-plugins.org). They are one of two distinct plugin lanes in Cline. The authoritative distinction is documented in `sdk/packages/shared/src/storage/paths.ts`:

- **Agent plugin** — a package with a root `plugin.json`, discovered under `.agents/plugins`
- **Cline plugin** — a JS/TS module, discovered under `.cline/plugins` (see [cline-plugins.md](./cline-plugins.md))

Do not confuse the product term "Agent Plugins" with the TypeScript type `AgentPlugin` — that type is an alias of `AgentExtension` and belongs to the *Cline plugin* API (`sdk/packages/core/src/index.ts`).

## Package format

Per `sdk/README.md` ("Portable Agent Plugins") and the loader at `sdk/packages/core/src/extensions/agent-plugin/loader.ts`:

- Each package is validated from its root `plugin.json` (schema `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`).
- Valid immediate-child Agent Skills under `skills/` are exposed through the `skills` tool as `plugin-name:skill-name`.
- Valid MCP servers from a root `mcp.json` (schema `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`) are connected **without modifying `cline_mcp_settings.json`**.
- Invalid packages, components, skills, and MCP entries fail at their specification-defined narrow boundaries (bad entries are rejected individually).

Types live in `sdk/packages/core/src/extensions/agent-plugin/types.ts` (`AgentPluginPackageManifest`, `LoadedAgentPluginPackage`, ...).

## Discovery and installation

- **Automatic discovery:** user-installed package directories under `~/.agents/plugins/*` on the Hub host (`resolveAgentPluginSearchPaths` in `sdk/packages/shared/src/storage/paths.ts`). "Installing" is placing a package directory there; there is no `cline plugin install` path for this lane (`cline plugin install` targets Cline plugins under `.cline/plugins`).
- **Workspace directories are intentionally NOT scanned.** Per `sdk/README.md`: "Automatic discovery intentionally does not scan workspace `.agents/plugins` directories, so opening a repository does not implicitly activate repository-controlled MCP servers."
- **Explicit opt-in roots:** hosts/sessions can pass `agentPluginPaths` in session config (`sdk/packages/core/src/types/config.ts`); relative paths are resolved against the session `cwd` and remain subject to package-boundary validation.

```typescript
const session = await cline.start({
  prompt: "Use the release plugin to prepare this repository",
  config: { providerId: "anthropic", modelId: "claude-sonnet-4-6", cwd: "/path/to/project",
            enableTools: true, agentPluginPaths: ["./vendor/release-plugin"] },
})
```

## Runtime behavior (from `sdk/README.md`)

- Discovery is **read-only**: loading settings validates manifests and inspects skills/`mcp.json` without starting MCP processes or creating plugin data directories. For stdio MCP servers, the runtime creates the persistent `PLUGIN_DATA` directory immediately before launching the server (Agent Plugins MCP contract).
- **The Hub owns enablement.** Hub-backed clients read the plugin inventory through settings APIs (`settings.list`) and toggle entries there rather than keeping client-local state. Settings items from this lane carry `agentPlugin: true` (`sdk/packages/core/src/settings/types.ts`). Disabled plugins are persisted by validated manifest name and contribute no skills/MCP servers.
- Every settings mutation publishes `settings.changed` so clients can refresh.
- Contributions are part of a session's **runtime snapshot**: an already-running turn keeps the tools/skills/rules it started with; new sessions pick up changes immediately; existing sessions pick them up when rebuilt or restarted (the CLI rebuilds an idle session after a toggle in its interactive settings view).
- Installing/removing files under `~/.agents/plugins` is detected on the next settings refresh or session build — there is no filesystem watcher for this directory.

## Support notes

- Symptom "my repo's `.agents/plugins` isn't loading" → expected; workspace scan is intentionally disabled. Use `~/.agents/plugins` or explicit `agentPluginPaths`.
- Symptom "toggled a plugin but the running session didn't change" → expected; runtime snapshot semantics. Start a new session or rebuild/restart.
- Symptom "MCP server from a plugin doesn't appear in `cline_mcp_settings.json`" → expected; plugin MCP servers are connected without editing that file.
- The CLI config screen lists Agent Plugins separately from Cline Plugins (`apps/cli/CHANGELOG.md`, 3.0.60–3.0.62).

## Known gaps on main

- There is no in-repo authoring guide for writing a `plugin.json` package; authoritative sources are the loader code (`sdk/packages/core/src/extensions/agent-plugin/`), `sdk/README.md`, and the external agent-plugins.org specification.
- No CLI command installs Agent Plugins; distribution is filesystem placement.
