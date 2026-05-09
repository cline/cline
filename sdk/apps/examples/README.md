# Cline SDK Examples

Learn how to build with the Cline SDK through practical, runnable examples.

## 📁 Plugin Examples

Plugins extend the CLI and SDK with custom capabilities. Install them in `~/.cline/plugins/`:

### [`plugins/`](./plugins/)

**Plugin module examples** showing how to extend the CLI and SDK with custom capabilities:

- Register custom tools
- Hook into agent lifecycle events
- Export a reusable plugin module for `.cline/plugins`

Examples include:
- `weather-plugin.example.ts` - Weather query tool
- `mac-notify.ts` - macOS Notification Center alerts
- `custom-compaction.ts` - Custom context compaction
- `automation-events.ts` - Plugin event emission
- `background-terminal.ts` - Background shell jobs with logging

```bash
mkdir -p ~/.cline/plugins
cp apps/examples/plugins/weather-plugin.example.ts ~/.cline/plugins/weather-metrics.ts
cline -i "What's the weather like in Tokyo and Paris?"
```

### [`plugins/typescript-lsp-plugin/`](./plugins/typescript-lsp-plugin)

TypeScript LSP plugin that gives the agent a `goto_definition` tool powered by the TypeScript Language Service API. Resolves through imports, re-exports, and type aliases -- much more precise than text search.

- Register a tool via `createTool()` and `AgentExtension`
- Use the TypeScript Language Service to resolve symbol definitions
- Cache the language service for efficient repeated lookups
- Zero extra dependencies -- resolves `typescript` from the target project

```bash
cp apps/examples/plugins/typescript-lsp-plugin/index.ts ~/.cline/plugins/typescript-lsp.ts
cline -i "Find where createTool is defined"
```

### [`plugins/subagent-plugin/`](./plugins/subagent-plugin)

**Portable subagent plugin** that adds background agent orchestration tools to the CLI and SDK:

- Export a reusable plugin module for `.cline/plugins`
- Start background subagents from the main session
- Load bundled or custom agent presets and skills

Includes pre-configured agents:
- **Anvil** - Build and compile
- **Inquisitor** - Investigation and discovery
- **Oracle** - Planning and architecture
- **Phantom** - Stealth and optimization

Skills available:
- API design, code review, debugging, documentation, migration, refactoring, test generation

```bash
mkdir -p ~/.cline/plugins
cp apps/examples/plugins/subagent-plugin/index.ts ~/.cline/plugins/portable-subagents.ts
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

Recurring jobs for continuous quality:
- **changelog-generator** — Auto-generate CHANGELOG from commits
- **dependency-check** — Weekly security and update audits
- **test-coverage-report** — Daily coverage metrics
- **performance-baseline** — Build time and bundle size tracking
- **type-check-strict** — TypeScript type safety audits
- **code-style-audit** — Linting and formatting checks
- **dead-code-finder** — Identify unused code
- **documentation-check** — API documentation coverage
- **weekly-metrics-summary** — Fun team metrics report 🎉

Event-driven jobs for PR workflows:
- **pr-changelog-check** — Verify CHANGELOG is updated in PRs
- **pr-test-coverage** — Analyze coverage impact of changes

```bash
mkdir -p ~/.cline/cron
cp apps/examples/cron/changelog-generator.cron.md ~/.cline/cron/
mkdir -p ~/.cline/cron/events
cp apps/examples/cron/events/pr-changelog-check.event.md ~/.cline/cron/events/
```

See [cron/README.md](./cron/README.md) for full descriptions and usage patterns.

### [`hooks/`](./hooks)

**Lifecycle hooks** written in bash, Python, or TypeScript that intercept agent actions at key points:

- Log all tool calls (PreToolUse) and results (PostToolUse)
- Block destructive operations
- Require review for critical files
- Inject contextual information
- Track lifecycle events (TaskStart, TaskComplete, SessionShutdown)

Hooks live in `.cline/hooks/` and are named after the event they handle (PreToolUse, PostToolUse, TaskStart, etc.):

```bash
mkdir -p ~/.cline/hooks

# Bash hook
cp apps/examples/hooks/PreToolUse.sh ~/.cline/hooks/
chmod +x ~/.cline/hooks/PreToolUse.sh

# Or Python
cp apps/examples/hooks/PreToolUse.py ~/.cline/hooks/PreToolUse.py
chmod +x ~/.cline/hooks/PreToolUse.py

# Or TypeScript (runs via bun)
cp apps/examples/hooks/PreToolUse.ts ~/.cline/hooks/PreToolUse.ts
chmod +x ~/.cline/hooks/PreToolUse.ts

cline -i "do something"  # Hooks will execute automatically
```

## 🚀 Quick Start

To use the SDK in your own Node app (outside this monorepo), start with:

```bash
npm add @clinebot/core
```

Add `@clinebot/agents` or `@clinebot/llms` only if you intentionally want lower-level control. For RPC client helpers, prefer importing from `@clinebot/core` when you want the app-facing SDK surface.

Current SDK layering:

- `@clinebot/core` owns config discovery/watchers, runtime plugin loading, and the context pipeline
- context compaction is core-owned and runs through turn preparation before model calls
- most app integrations should stay on the `@clinebot/core` surface unless they intentionally need lower-level agent or model control

## 📚 Learning Path

**Building plugins?**
- Start with [`plugins/`](./plugins/) for basic tool and event patterns
- Explore [`plugins/typescript-lsp-plugin/`](./plugins/typescript-lsp-plugin) for integration with language services
- See [`plugins/subagent-plugin/`](./plugins/subagent-plugin) for advanced agent orchestration

**Building integrations?**
- Check out [`slack-bot/`](./slack-bot) for production patterns and best practices
- Review [`cron/`](./cron) for automation and event-driven workflows

**Controlling agent behavior?**
- Explore [`hooks/`](./hooks) to intercept and modify tool execution, log actions, or enforce policies

## 📖 Documentation

- [Cline SDK README](../../packages/README.md)
- [Architecture Guide](../../ARCHITECTURE.md)
- [Individual Package Docs](../../packages/)

## 🛠️ Requirements

- **Node.js 22+** - For package compatibility
- **API Key** - Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or provider-specific key (for SDK examples)
- **Bun** - Optional, install from [bun.sh](https://bun.sh) for running examples
