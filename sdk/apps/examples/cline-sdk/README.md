# Build with Cline SDK

**Learn how to build AI agents with the Cline SDK** through practical, runnable examples—from simple one-liners to advanced multi-agent systems.

## 📚 Examples

All examples are fully type-safe, tested, and ready to run with `bun run <filename>`.

### Learning Path

**New to Cline SDK?** Start here:
1. [01-minimal.ts](./01-minimal.ts) - Get your first agent running
2. [02-custom-model.ts](./02-custom-model.ts) - Switch providers and models
3. [04-tools.ts](./04-tools.ts) - Control what the agent can do

**Building custom functionality?** Check out:
- [05-custom-tools.ts](./05-custom-tools.ts) - Add your own tools
- [06-hooks.ts](./06-hooks.ts) - Monitor agent behavior
- [07-extensions.ts](./07-extensions.ts) - Extend agent capabilities
- [12-custom-executors.ts](./12-custom-executors.ts) - Override tool behavior

**Working with multiple agents?** Explore:
- [10-spawn-agents.ts](./10-spawn-agents.ts) - Parallel sub-tasks
- [11-teams.ts](./11-teams.ts) - Coordinated multi-agent teams

**Production deployment?** See:
- [09-sessions.ts](./09-sessions.ts) - Session management
- [13-full-control.ts](./13-full-control.ts) - Complete control

### All Examples

| File | Level | Description |
|------|-------|-------------|
| [01-minimal.ts](./01-minimal.ts) | Beginner | Minimal working session with default config—perfect starting point |
| [02-custom-model.ts](./02-custom-model.ts) | Beginner | Switch between providers (Anthropic, OpenAI, OpenRouter) and models |
| [03-system-prompt.ts](./03-system-prompt.ts) | Beginner | Customize agent personality and behavior via system prompts |
| [04-tools.ts](./04-tools.ts) | Beginner | Control tool policies (enabled, auto-approve, require-approval) |
| [05-custom-tools.ts](./05-custom-tools.ts) | Intermediate | Create custom tools with schemas and executors |
| [06-hooks.ts](./06-hooks.ts) | Intermediate | Hook into lifecycle events (run start, tool calls, execution phases) |
| [07-extensions.ts](./07-extensions.ts) | Intermediate | Build extensions with setup, onToolCall, onToolResult, onRunEnd |
| [08-context-files.ts](./08-context-files.ts) | Intermediate | Add workspace files and URLs as context for the agent |
| [09-sessions.ts](./09-sessions.ts) | Intermediate | List, resume, and manage persistent sessions across runs |
| [10-spawn-agents.ts](./10-spawn-agents.ts) | Advanced | Spawn child agents for parallel sub-tasks within a session |
| [11-teams.ts](./11-teams.ts) | Advanced | Multi-agent teams with planning and execution modes |
| [12-custom-executors.ts](./12-custom-executors.ts) | Advanced | Override built-in tool executors (bash) with custom logic |
| [13-full-control.ts](./13-full-control.ts) | Advanced | Full example combining tools, hooks, extensions, and custom executors |

## 🚀 Quick Start

```bash
# Install dependencies
cd apps/examples/cline-sdk
bun install

# Run any example
bun run 01-minimal.ts
```

Using these SDK packages in your own app (npm/pnpm/yarn):

```bash
npm add @clinebot/core @clinebot/agents @clinebot/llms
```

If you need RPC client/server helpers, import them from `@clinebot/rpc` directly. `@clinebot/core` is now the transport-agnostic session/runtime package.

> **Note:** `createSessionHost` works without the CLI app installed. It runs local in-process sessions and falls back to a local SQLite backend when RPC is unavailable. Use `CLINE_BACKEND_MODE=local` to force local mode explicitly.

```bash
# Run with explicit local backend (no RPC)
CLINE_BACKEND_MODE=local bun run 13-full-control.ts
```

## 📖 Core Concepts

### Packages

The Cline SDK is organized into focused packages:

- **`@clinebot/core`** - Session management, storage, runtime orchestration
- **`@clinebot/rpc`** - Optional remote-session helpers (`RpcSessionClient`, `getRpcServerHealth`, etc.)
- **`@clinebot/agents`** - Agent runtime loop, tools, hooks, teams
- **`@clinebot/llms`** - Model catalog, provider settings, handlers
- Shared primitives/types/path helpers are consumed through `@clinebot/core` re-exports in app/example code.

### Session Flow

1. **Create Session Manager** - Entry point for managing agent sessions
2. **Start Session** - Initialize agent with config and prompt
3. **Handle Events** - Subscribe to streaming events
4. **Continue/Abort** - Send follow-ups or cancel execution
5. **Read Artifacts** - Access transcript logs and session data

### Built-in Tools

The SDK provides production-ready tools out of the box:

| Tool | Description |
|------|-------------|
| `read_files` | Read one or more files from filesystem |
| `search_codebase` | Search code using regex/glob patterns |
| `run_commands` | Execute shell commands safely |
| `fetch_web_content` | Fetch and analyze web pages |
| `ask_followup_question` | Ask user for clarification |
| `editor` | Advanced file editing operations |
| `skills` | Execute configured workflow skills |

All tools respect the agent's working directory and can be customized with policies and executors.

## 📘 Usage Patterns

### Minimal Session

```typescript
import { createSessionHost } from "@clinebot/core";

const sessionManager = await createSessionHost({});

const result = await sessionManager.start({
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    cwd: process.cwd(),
    systemPrompt: "You are a helpful coding assistant",
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
  },
  prompt: "List files in current directory",
  interactive: false,
});

console.log(result.result?.text);
```

### With Custom Model

```typescript
import { createSessionHost } from "@clinebot/core";

await sessionManager.start({
  config: {
    providerId: "openai",
    modelId: "gpt-4",
    apiKey: process.env.OPENAI_API_KEY!,
    cwd: process.cwd(),
    thinking: true, // Enable extended thinking
    maxIterations: 25,
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
  },
  prompt: "Explain this codebase",
});
```

### Event Streaming

```typescript
const sessionManager = await createSessionHost({});

// Subscribe to all session events
sessionManager.subscribe((event) => {
  if (event.type === "chunk") {
    // Stream assistant response
    process.stdout.write(event.payload.chunk);
  }
  
  if (event.type === "agent_event") {
    const agentEvent = event.payload.event;
    if (agentEvent.type === "content_start" && agentEvent.contentType === "tool") {
      console.log(`Tool: ${agentEvent.toolName}`);
    }
  }
});

await sessionManager.start({ /* ... */ });
```

### Session Management

```typescript
// List all sessions
const sessions = await sessionManager.list(10);

// Resume a previous session
await sessionManager.send({
  sessionId: sessions[0].sessionId,
  prompt: "Continue from where we left off",
});

// Stop a running session
await sessionManager.stop(sessionId);
```

### Custom Tools

```typescript
import { createSessionHost } from "@clinebot/core";
import type { Tool } from "@clinebot/agents";

const myTool: Tool = {
  name: "get_weather",
  description: "Get weather for a location",
  inputSchema: {
    type: "object",
    properties: {
      location: { type: "string" }
    },
    required: ["location"]
  },
};

const sessionManager = await createSessionHost({});

await sessionManager.start({
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    cwd: process.cwd(),
    enableTools: true,
    enableSpawnAgent: false,
    enableAgentTeams: false,
    extraTools: [myTool],
  },
  toolExecutors: {
    get_weather: async (input) => {
      const location = (input as { location: string }).location;
      const data = await fetchWeather(location);
      return `Weather: ${data.temp}°F`;
    },
  },
  prompt: "What's the weather in San Francisco?",
});
```

### Tool Policies

Control which tools the agent can use and whether they require approval:

```typescript
await sessionManager.start({
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    cwd: process.cwd(),
    enableTools: true,
  },
  toolPolicies: {
    read_file: { enabled: true, autoApprove: true },
    run_in_terminal: { enabled: true, autoApprove: false },
    write_to_file: { enabled: false },
  },
  requestToolApproval: async (request) => {
    console.log(`Approve ${request.toolName}? Input:`, request.input);
    // Implement your approval logic
    return { approved: true, reason: "User approved" };
  },
});
```

## 🔧 Configuration

### Provider Settings

Cline supports multiple AI providers:

- **Anthropic** - Claude models (Opus, Sonnet, etc.)
- **OpenAI** - GPT models
- **Google** - Gemini models
- And more...

Set API keys via environment variables or provider settings:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=...
```

### Session Config

Key configuration options:

```typescript
interface CoreSessionConfig {
  // Provider & model
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  
  // Working directory
  cwd: string;
  workspaceRoot?: string;
  
  // Behavior
  systemPrompt?: string;
  thinking?: boolean;
  maxIterations?: number;
  
  // Required feature flags
  enableTools: boolean;
  enableSpawnAgent: boolean;
  enableAgentTeams: boolean;
  
  // Team mode
  teamName?: string;
  mode?: "act" | "plan";
}
```

> **Important:** `enableTools`, `enableSpawnAgent`, and `enableAgentTeams` are required boolean flags. Set them explicitly based on your use case.

## 🎯 Use Cases

### Code Analysis

Perfect for understanding and explaining codebases:

```typescript
await sessionManager.start({
  config: { /* ... */ },
  prompt: "Analyze the architecture of this project",
});
```

### Code Generation

Generate code with context awareness:

```typescript
await sessionManager.start({
  config: { /* ... */ },
  prompt: "Create a REST API endpoint for user authentication",
});
```

### Refactoring

Safely refactor with built-in tools:

```typescript
await sessionManager.start({
  config: { /* ... */ },
  toolPolicies: {
    editor: ToolPolicy.Allowed,
  },
  prompt: "Refactor the database module to use TypeORM",
});
```

### Multi-Step Tasks

Use spawn agents or teams for complex workflows:

```typescript
await sessionManager.start({
  config: {
    enableSpawnAgent: true,
    // ...
  },
  prompt: "Build a full-stack todo app with tests",
});
```

## 🌐 Deployment

The Cline SDK can be deployed anywhere Node.js runs:

- **Local CLI** - Direct script execution
- **Web Services** - Express, Fastify, Next.js API routes
- **Serverless** - AWS Lambda, Vercel Functions
- **Docker** - Containerized agents
- **RPC Mode** - Client/server architecture for scaling

## 🛠️ Development Tips

### Storage Paths

Sessions are stored in `~/.cline/data/sessions/` by default. Override with:

```typescript
process.env.CLINE_SESSION_DATA_DIR = "/custom/path";
```

### Debugging

Enable verbose logging:

```typescript
const logger = {
  debug: (message: string, metadata?: Record<string, unknown>) => {
    console.debug("[cline]", message, metadata);
  },
  info: (message: string, metadata?: Record<string, unknown>) => {
    console.info("[cline]", message, metadata);
  },
  warn: (message: string, metadata?: Record<string, unknown>) => {
    console.warn("[cline]", message, metadata);
  },
  error: (message: string, metadata?: Record<string, unknown>) => {
    console.error("[cline]", message, metadata);
  },
};

await sessionManager.start({
  config: {
    logger,
    // ...
  },
});
```

### Testing

Mock tools and providers for unit tests:

```typescript
import { Agent } from "@clinebot/agents";

const mockTool = {
  name: "test_tool",
  execute: vi.fn().mockResolvedValue({ success: true }),
  // ...
};

const agent = new Agent({
  providerId: "mock",
  tools: [mockTool],
  // ...
});
```

## 📚 Additional Resources

- **Package Docs**: [`packages/README.md`](../../../packages/README.md)
- **Architecture**: [`AGENTS.md`](../../../AGENTS.md)
- **CLI Examples**: [`apps/cli`](../../cli)
- **API Reference**: Package-specific READMEs in [`packages/`](../../../packages)

## 🤝 Contributing

Found an issue or have a better example? Contributions welcome!

1. Add your example file
2. Update the examples table above
3. Test with `bun run your-example.ts`
4. Submit a PR

## 📄 License

See repository root for license information.
