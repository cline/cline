# Cline SDK Examples

Learn how to build with the Cline SDK through practical, runnable examples.

## 📁 Example Collections

### [`cline-sdk/`](./cline-sdk)

**13 step-by-step examples** covering everything from basic agent sessions to advanced multi-agent systems:

- **Beginner** (01-04): Minimal sessions, model selection, system prompts, tool policies
- **Intermediate** (05-09): Custom tools, hooks, extensions, context files, session management
- **Advanced** (10-13): Spawn agents, teams, custom executors, full control

👉 [View all cline-sdk examples →](./cline-sdk/README.md)

```bash
cd apps/examples/cline-sdk
bun run 01-minimal.ts  # Get started in 30 seconds
```

### [`cline-plugin/`](./cline-plugin)

**Plugin module example** showing how to extend the CLI and SDK with custom capabilities:

- Register custom tools
- Hook into agent lifecycle events
- Export a reusable plugin module for `.clinerules/plugins`

```bash
mkdir -p .clinerules/plugins
cp apps/examples/cline-plugin/index.ts .clinerules/plugins/weather-metrics.ts
clite -i "What's the weather like in Tokyo and Paris?"
```

### [`subagent-plugin/`](./subagent-plugin)

**Portable subagent plugin** that adds background agent orchestration tools to the CLI and SDK:

- Export a reusable plugin module for `.clinerules/plugins`
- Start background subagents from the main session
- Load bundled or custom agent presets and skills

```bash
mkdir -p ~/.cline/plugins
cp apps/examples/subagent-plugin/index.ts ~/.cline/plugins/portable-subagents.ts
clite -i "Use subagents to inspect this repository and report back."
```

Once loaded, the agent can call tools like `start_subagent`, `message_subagent`, `get_subagent`, `list_agent_presets`, `list_skills`, and the handoff tools.

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

## 🚀 Quick Start

All examples run with Bun:

```bash
# From workspace root
bun install
bun run build:sdk

# Run any example
cd apps/examples/cline-sdk
bun run 01-minimal.ts
```

> **Note:** Examples work without the CLI installed. They use local in-process sessions with automatic SQLite fallback.

To use the SDK in your own Node app (outside this monorepo), install published packages:

```bash
npm add @clinebot/core @clinebot/agents @clinebot/llms
```

For RPC client helpers, import from `@clinebot/core` (re-exported there), not `@clinebot/rpc`.

## 📚 Learning Path

**New to Cline?**
1. Start with [`cline-sdk/01-minimal.ts`](./cline-sdk/01-minimal.ts)
2. Explore tool policies in [`cline-sdk/04-tools.ts`](./cline-sdk/04-tools.ts)
3. Add custom functionality in [`cline-sdk/05-custom-tools.ts`](./cline-sdk/05-custom-tools.ts)

**Building integrations?**
- Check out the [`slack-bot/`](./slack-bot) for production patterns
- See [`cline-plugin/`](./cline-plugin) and [`subagent-plugin/`](./subagent-plugin) for reusable extensions

**Going to production?**
- Session management: [`cline-sdk/09-sessions.ts`](./cline-sdk/09-sessions.ts)
- Full control: [`cline-sdk/13-full-control.ts`](./cline-sdk/13-full-control.ts)

## 📖 Documentation

- [Cline SDK README](../../packages/README.md)
- [Architecture Guide](../../AGENTS.md)
- [Individual Package Docs](../../packages/)

## 🛠️ Requirements

- **Bun** - Install from [bun.sh](https://bun.sh)
- **API Key** - Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or provider-specific key
- **Node.js 18+** - For package compatibility
