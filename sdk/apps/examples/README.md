# Cline SDK Examples

Learn how to build with the Cline SDK through working examples, ordered from simple to complex.

## Getting started

All examples live in this directory. Each is a standalone project with its own `package.json` and README. To run any example:

```bash
cd apps/examples/<example-name>
bun install
bun run build:sdk
export CLINE_API_KEY="cline_..."
bun dev
```

Requires Node.js 22+.

## Examples

### Beginner

| Example | Description | Concepts |
|---------|-------------|----------|
| [quickstart](./quickstart) | Send one prompt, stream the response. ~15 lines of code. | `Agent`, `subscribe`, `run()` |
| [cli-agent](./cli-agent) | Interactive terminal chat with a shell tool. | `createTool`, multi-turn `run()`/`continue()`, streaming |

### Intermediate

| Example | Description | Concepts |
|---------|-------------|----------|
| [code-review-bot](./code-review-bot) | AI code reviewer that reads git diffs and produces structured comments. | Multiple tools, `completesRun` lifecycle, `systemPrompt`, zod schemas |
| [multi-agent](./multi-agent) | Web app that fans out to three specialist agents in parallel, streams results via SSE, then synthesizes a unified answer. | Concurrent agents, `Promise.all`, per-agent `subscribe()`, SSE streaming, agent composition |

### Advanced

| Example | Description | Concepts |
|---------|-------------|----------|
| [desktop-app](./desktop-app) | Full Tauri + Next.js desktop app for running and inspecting chat sessions. | Sidecar runtime, websocket transport, session persistence |
| [menubar](./menubar) | macOS menu bar app with Tauri. | Native app integration, compact UI |
| [vscode](./vscode) | VS Code extension with chat panel. | Extension API, webview, workspace context |
| [slack-bot](./slack-bot) | Slack bot integration. | Event-driven, external service integration |

## SDK packages

When building your own app, install the public SDK package:

```bash
npm add @cline/sdk
```

`@cline/sdk` re-exports everything from `@cline/core`. You only need `@cline/agents` or `@cline/llms` if you want lower-level control over the agent runtime or model gateway directly.

## Learn more

- [SDK package docs](../../packages/README.md)
- [Architecture guide](../../ARCHITECTURE.md)
- [Plugin examples](../../examples/plugins) - extend the Cline SDK and CLI with custom tools and event hooks
- [Hook examples](../../examples/hooks) - lifecycle hooks for logging, blocking, and injection for Cline SDK and CLI
