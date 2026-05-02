# Cline SDK Examples

Learn how to build with the Cline SDK through practical, runnable examples.

## 📁 Plugin Examples

### [`hooks/`](./hooks)

Hook-focused examples for lifecycle automation:

- `agent_end.sh` shows a file hook that runs only when a task completes successfully
- `custom-compaction-hook.example.ts` shows a runtime `beforeModel` hook that rewrites provider-bound messages for custom compaction

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/agent_end.sh .cline/hooks/agent_end.sh
chmod +x .cline/hooks/agent_end.sh
```

### [`cline-plugin/`](./plugin-examples/cline-plugin)

**Plugin module example** showing how to extend the CLI and SDK with custom capabilities:

- Register custom tools
- Hook into agent lifecycle events
- Export a reusable plugin module for `.cline/plugins`

```bash
mkdir -p .cline/plugins
cp apps/examples/plugin-examples/cline-plugin/weather-plugin.example.ts .cline/plugins/weather-metrics.ts
cline -i "What's the weather like in Tokyo and Paris?"
```

### [`typescript-lsp-plugin/`](./plugin-examples/typescript-lsp-plugin)

TypeScript LSP plugin that gives the agent a `goto_definition` tool powered by the TypeScript Language Service API. Resolves through imports, re-exports, and type aliases -- much more precise than text search.

- Register a tool via `createTool()` and `AgentPlugin`
- Use the TypeScript Language Service to resolve symbol definitions
- Cache the language service for efficient repeated lookups
- Zero extra dependencies -- resolves `typescript` from the target project

```bash
cp apps/examples/plugin-examples/typescript-lsp-plugin/index.ts ~/.cline/plugins/typescript-lsp.ts
cline -i "Find where createTool is defined"
```

### [`subagent-plugin/`](./plugin-examples/subagent-plugin)

**Portable subagent plugin** that adds background agent orchestration tools to the CLI and SDK:

- Export a reusable plugin module for `.cline/plugins`
- Start background subagents from the main session
- Load bundled or custom agent presets and skills

```bash
mkdir -p ~/.cline/plugins
cp apps/examples/plugin-examples/subagent-plugin/index.ts ~/.cline/plugins/portable-subagents.ts
cline -i "Use subagents to inspect this repository and report back."
```

Once loaded, the agent can call tools like `start_subagent`, `message_subagent`, `get_subagent`, `list_agent_presets`, `list_skills`, and the handoff tools.

## 📁 App Examples

### [`slack-bot/`](./slack-bot)

**Production Slack bot** integrating the chat SDK with Cline agents:

- Single and multi-workspace support
- Thread-level conversation memory
- Slash commands and OAuth flows
- Deployment-ready architecture

```bash
cd apps/examples/slack-bot
# Configure .env with Slack credentials
bun run src/index.ts
```

### [`cron/`](./cron)

**Example file-based and event-driven automation specs** for global `~/.cline/cron/`:

- Copy a recurring spec into `~/.cline/cron/`
- Copy event specs into `~/.cline/cron/events/`
- Use them as templates for one-off, scheduled, or event-driven automation
- Pair `events/local-plugin-event.event.md` with `cline-plugin/automation-events.ts`
  to test plugin-emitted normalized events locally
- Enable automation through `ClineCore.create({ automation: true, backendMode: "local" })`

```bash
mkdir -p ~/.cline/cron
cp apps/examples/cron/daily-code-review.cron.md ~/.cline/cron/
mkdir -p ~/.cline/cron/events
cp apps/examples/cron/events/local-manual-test.event.md ~/.cline/cron/events/
```

## 🚀 Quick Start

All examples run with Bun:

```bash
# From workspace root
bun install
bun run build:sdk

# Run a direct plugin demo with a local in-process runtime
ANTHROPIC_API_KEY=sk-... bun run apps/examples/plugin-examples/cline-plugin/weather-plugin.example.ts
```

> **Note:** Direct SDK demos choose their backend explicitly when that matters. The subagent plugin defaults to `backendMode: "auto"` so it can use the shared hub when available and fall back locally.

To use the SDK in your own Node app (outside this monorepo), start with the simplest path:

```bash
npm add @clinebot/core
```

Add `@clinebot/agents` or `@clinebot/llms` only if you intentionally want lower-level control. For hub and session client helpers, prefer importing from `@clinebot/core` when you want the app-facing SDK surface.

Current SDK layering:

- `@clinebot/core` owns config discovery/watchers, runtime plugin loading, and the context pipeline
- context compaction is core-owned and runs through turn preparation before model calls
- most app integrations should stay on the `@clinebot/core` surface unless they intentionally need lower-level agent or model control

## 📚 Learning Path

**Building integrations?**
- Check out the [`slack-bot/`](./slack-bot) for production patterns
- See [`cline-plugin/`](./plugin-examples/cline-plugin), [`typescript-lsp-plugin/`](./plugin-examples/typescript-lsp-plugin), and [`subagent-plugin/`](./plugin-examples/subagent-plugin) for reusable extensions

## 📖 Documentation

- [Cline SDK README](../../packages/README.md)
- [Architecture Guide](../../ARCHITECTURE.md)
- [Individual Package Docs](../../packages/)

## 🛠️ Requirements

- **Bun** - Install from [bun.sh](https://bun.sh)
- **API Key** - Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or provider-specific key
- **Node.js 22+** - For package compatibility
