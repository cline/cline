# Cline Configuration Files

> Support-agent reference. Grounded on `main` @ `025baa8fb76d9bdb8a351177bc51b6c2721e18fa` (github.com/cline/cline). The canonical path resolver for the SDK/CLI stack is `sdk/packages/shared/src/storage/paths.ts`; where public docs disagree with code, code (main) wins and the conflict is noted.

## Directory layout

**Root:** `~/.cline` (override with `CLINE_DIR`). **Data root:** `~/.cline/data` (override with `CLINE_DATA_DIR`).

### Settings files — `~/.cline/data/settings/`

| File | Purpose | Env override |
|---|---|---|
| `providers.json` | Model provider credentials + model selection | `CLINE_PROVIDER_SETTINGS_PATH` |
| `global-settings.json` | Global app settings | `CLINE_GLOBAL_SETTINGS_PATH` |
| `cline_mcp_settings.json` | MCP server configuration | `CLINE_MCP_SETTINGS_PATH` |

There is no separate `user-settings.json` on main. A legacy `~/.cline/data/secrets.json` exists only as a one-time migration source into `providers.json` (`sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts`).

### Other data paths — `~/.cline/data/`

| Path | Purpose |
|---|---|
| `sessions/` | Session persistence (SQLite index + JSON snapshots) |
| `teams/` | Agent team persistence (`CLINE_TEAM_DATA_DIR`) |
| `connectors/` + `connectors/settings.json` | Connector (channel) state |
| `db/` | `connectors.db`, `cron.db`, `tasks.db` |
| `logs/` | Runtime logs; connector logs at `logs/connectors/<channel>/<instance>.log` |
| `workspaces/chat/` | Default shared chat workspace for sessions started without a `cwd` |

### Extension directories — `~/.cline/` (global) and `<workspace>/.cline/` (project)

| Directory | Contents |
|---|---|
| `rules/` | Rule markdown files |
| `skills/` | Skill directories (each containing `SKILL.md`) |
| `workflows/` | Workflow markdown files |
| `hooks/` | File hooks (external scripts) |
| `agents/` | Configured agent definitions (YAML) |
| `plugins/` | Cline plugins (JS/TS modules; installs land under `plugins/_installed/`) |
| `cron/` | Automation specs (`*.md`, `events/*.event.md`, `reports/`) |
| `tasks/` | Agenda task specs (`*.task.md`) |
| `schedules/` | Agent-created schedules |

Compatibility roots also searched: `~/Documents/Cline/{Rules,Hooks,Plugins,Workflows}`, `~/Cline/Rules`, and the vendor-neutral `~/.agents/skills`, `~/.agents/AGENTS.md`, `~/.agents/plugins`.

CLI flags: `--config <path>` (config dir), `--data-dir <path>` (isolated state, enables sandbox mode). Docs overview page: `docs/getting-started/config.mdx` (note: it claims global workflows live at `~/.cline/data/workflows/`; code resolves `~/.cline/workflows`).

## Model providers

Persisted in `~/.cline/data/settings/providers.json`. Shape (`sdk/packages/core/src/types/provider-settings.ts`):

```json
{
  "version": 1,
  "lastUsedProvider": "anthropic",
  "providers": {
    "anthropic": {
      "settings": { "provider": "anthropic", "model": "...", "apiKey": "..." },
      "updatedAt": "...",
      "tokenSource": "manual"
    }
  }
}
```

Per-provider settings support `apiKey`, `auth` (OAuth tokens), `model`, `baseUrl`, `headers`, `timeout`, `reasoning`, and cloud-specific blocks (`aws`, `gcp`, `azure`, `sap`, `oca`) — `sdk/packages/core/src/services/llms/provider-settings.ts`.

Configure via `cline auth` (interactive TUI) or `cline auth --provider <id> --apikey <key> --modelid <id>` (`apps/cli/src/commands/auth.ts`). Environment keys per provider are declared in `sdk/packages/llms/src/providers/builtins.ts` (`apiKeyEnv`), e.g. `CLINE_API_KEY` (cline/cline-pass), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`. The `--key` CLI flag overrides env vars. Provider ids are enumerated in `sdk/packages/llms/src/providers/ids.ts` (built-ins such as `anthropic`, `claude-code`, `cline`, `cline-pass`, `openai-native`, `openai-compatible`, `bedrock`, `vertex`, `gemini`, `ollama`, `lmstudio`, `openrouter`) plus a large generated catalog (`provider-ids.generated.ts`).

## Rules

Search paths, in order (`resolveRulesConfigSearchPaths` in `paths.ts`):

1. `<workspace>/AGENTS.md`
2. `<workspace>/.clinerules` (file or directory — deprecated name, still loaded)
3. `<workspace>/.cline/rules/`
4. `~/.agents/AGENTS.md`
5. `~/.cline/rules/`
6. `~/Cline/Rules`, `~/Documents/Cline/Rules`

Loader accepts `.md`/`.markdown`/`.txt` and honors a `disabled` frontmatter flag (`sdk/packages/core/src/extensions/config/user-instruction-config-loader.ts`). The VS Code extension additionally reads `.cursorrules`, `.windsurfrules`, and recursive `AGENTS.md` (`apps/vscode/src/core/storage/disk.ts`) — the SDK/CLI stack does not. `CLAUDE.md` is not loaded by the SDK/CLI on main. Docs page `docs/customization/cline-rules.mdx` is still `.clinerules/`-centric; code prefers `.cline/rules`.

## Skills

A skill is a directory containing `SKILL.md` with YAML frontmatter (`name`, `description`) plus a markdown body. Search paths (`resolveSkillsConfigSearchPaths`):

- `<workspace>/.clinerules/skills`, `<workspace>/.cline/skills`, `<workspace>/.agents/skills`
- `~/.cline/skills`, `~/.agents/skills`

Agent Plugins can also contribute skills, exposed as `plugin-name:skill-name` (see [agent-plugins.md](./agent-plugins.md)). The CLI forwards `cline skill` to `npx skills`. Note: `docs/customization/skills.mdx` mentions `.claude/skills/`, which is not in the SDK search paths on main.

## Workflows

Markdown files under `<workspace>/.clinerules/workflows`, `<workspace>/.cline/workflows`, `~/.cline/workflows`, or `~/Documents/Cline/Workflows` (`resolveWorkflowsConfigSearchPaths`).

## MCP

**SDK/CLI config file:** `~/.cline/data/settings/cline_mcp_settings.json`. Format uses a top-level `mcpServers` key with nested `transport` (from `sdk/packages/core/src/extensions/mcp/config-loader.ts` and its tests):

```json
{
  "mcpServers": {
    "docs": { "transport": { "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] } },
    "search": { "transport": { "type": "streamableHttp", "url": "https://mcp.example.com" }, "disabled": true }
  }
}
```

Transports: `stdio`, `sse`, `streamableHttp` (legacy `http` maps to streamableHttp); legacy flat `command`/`url` entries are also accepted, plus `timeout` (1–3600s) and OAuth fields.

**CLI management:** `cline mcp` / `cline config mcp` opens a wizard; `cline mcp install <name> -- <command...>` or `cline mcp install <name> --transport http|sse <url>` prefills it (requires a TTY) — `apps/cli/README.md`.

**VS Code extension:** now shares the same `~/.cline/data/settings/cline_mcp_settings.json`; a legacy copy under the extension's `{globalStorage}/settings/` is migrated by `apps/vscode/src/hosts/vscode/mcp-settings-legacy-migration.ts`. The extension's MCP connection manager is the `McpHub` class (`apps/vscode/src/services/mcp/McpHub.ts`) — not related to the Cline Hub daemon.

**Docs conflict:** `docs/mcp/mcp-overview.mdx` claims the CLI config is `~/.cline/mcp.json` — wrong versus code; the real path is `~/.cline/data/settings/cline_mcp_settings.json`.

## System prompts

There is no global system-prompt override file on main. Overrides exist as:

- CLI flag: `cline -s "custom system prompt"` (per run).
- Session config: `systemPrompt` on `Agent`/`ClineCore` config (SDK).
- Configured agent definitions: the YAML body of an agent file is its system prompt (below).
- Cron spec frontmatter `systemPrompt` (`sdk/examples/cron/`).
- Built-in defaults live at `sdk/packages/shared/src/prompt/system/` (`act.ts`, `yolo.ts`); rules are injected into templates as `{{CLINE_RULES}}` (`sdk/packages/shared/src/prompt/cline.ts`).

## Channels (Slack, Telegram, Discord) — "Connectors"

In this codebase, chat-channel integrations are called **connectors**. Supported platforms (`CONNECTOR_PLATFORMS` in `sdk/packages/shared/src/connectors/platforms.ts`): `telegram`, `slack`, `discord`, `whatsapp`, `gchat`, `linear`. Each conversation thread maps to a hub-backed session with full context.

- Start: `cline connect telegram -k <bot-token>`, `cline connect slack --bot-token ... --signing-secret ... --base-url ...` (webhook) or `--app-token ...` (socket mode), `cline connect gchat|whatsapp|linear ...`. Stop: `cline connect --stop [adapter]` (`apps/cli/README.md`).
- In-chat slash commands: `/help`, `/start`, `/new`, `/clear`, `/whereami`, `/tools`, `/yolo`, `/cwd <path>`, `/schedule`, `/abort`, `/exit`.
- State: SQLite at `~/.cline/data/db/connectors.db`; settings at `~/.cline/data/connectors/settings.json`; logs under `~/.cline/data/logs/connectors/`. The `@cline/shared/db` package owns the store; `@cline/core` owns autostart/reconnect orchestration, with the detached hub daemon as the sole startup reconnect owner (`sdk/ARCHITECTURE.md`, "Connector Persistence and Recovery").
- Hub command family: `connector.configure`, `connector.start`, ... (`sdk/packages/core/src/hub/server/handlers/connector-handlers.ts`).
- Docs: `docs/cli/connectors.mdx`; Telegram-specific notes at `apps/cli/src/connectors/adapters/telegram.md`.

There is no separate "channels.json"; credentials are supplied as CLI flags/wizard input and persisted in the connector store.

## Agent profiles → "configured agents"

The term "agent profile" does not exist on main. The equivalent feature is **configured agents**: YAML files in `<workspace>/.cline/agents/` or `~/.cline/agents/` (`resolveAgentConfigSearchPaths`). Format (`sdk/packages/core/src/extensions/tools/team/configured-agent-config.ts`):

```yaml
---
name: code-reviewer
description: Reviews code
tools: execute_command, read_file
skills:
  - review-pr
modelId: anthropic/claude-sonnet-4.6
---
You are a code reviewer.   # body = system prompt
```

Schema also allows `providerId` and `maxIterations`.

## Hooks

Two systems (see [cline-plugins.md](./cline-plugins.md)): file hooks — external scripts under `.cline/hooks/` (workspace or `~/.cline/hooks/`, plus `~/Documents/Cline/Hooks`) invoked with serialized JSON — and typed in-process plugin hooks. `cline hook` handles a hook payload from stdin; `--hooks-dir` adds a directory hint. Docs: `docs/customization/hooks.mdx`.

## Settings mutation rule (support-relevant)

Per `sdk/ARCHITECTURE.md` ("Settings Mutation Boundary"): hosts should not hand-edit skill/tool/MCP/provider settings files while a hub is running — mutations flow through core settings services or the hub `settings.list`/`settings.toggle` commands, and successful mutations publish `settings.changed`. Manual file edits are picked up by watchers/refresh, but the hub-owned toggles (e.g. Agent Plugin enablement) live in hub state, not in the files.

## Quick path-drift table (docs vs code — main wins)

| Public docs claim | Actual on main |
|---|---|
| CLI MCP config `~/.cline/mcp.json` (`docs/mcp/mcp-overview.mdx`) | `~/.cline/data/settings/cline_mcp_settings.json` |
| Global workflows `~/.cline/data/workflows/` (`docs/getting-started/config.mdx`) | `~/.cline/workflows/` |
| `.claude/skills/` loaded (`docs/customization/skills.mdx`) | Not in SDK search paths |
| `.clinerules/` as primary rules location (`docs/customization/cline-rules.mdx`) | Deprecated but still loaded; `.cline/rules/` preferred |
