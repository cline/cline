# Cline SDK

The Cline SDK lets you embed Cline as a programmable coding agent in your Node.js applications. It exposes the same capabilities as the Cline CLI and VS Code extension — file editing, command execution, browser use, MCP servers — through a TypeScript API that conforms to the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/protocol/schema).

## Installation

```bash
npm install cline
```

If you want direct ACP type imports as well:

```bash
npm install @agentclientprotocol/sdk
```

Requires Node.js 20+.

## Quick Start

```typescript
import { ClineAgent } from "cline";

const CLINE_DIR = "/Users/username/.cline";
const agent = new ClineAgent({ clineDir: CLINE_DIR });

// 1. Initialize — negotiates capabilities
const initializeResponse = await agent.initialize({
    protocolVersion: 1,
    // these are the capabilities that the client (you) supports
    // The cline agent may or may not use them, but it needs to know about them to make informed decisions about what tools to use.
    clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
    },
});

const { agentInfo, authMethods } = initializeResponse;
console.log("Agent info:", agentInfo); // contains things like agent name and version
console.log("Auth methods:", authMethods); // contains a list of supported authentication methods. More auth methods coming soon

// 2. Authenticate if needed
// If you skip this step, ClineAgent will look in CLINE_DIR for any existing credentials and authenticate with those
await agent.authenticate({ methodId: "cline-oauth" });

// 3. Create a session.
// A session represents a conversation or task with the agent. You can have multiple sessions for different tasks or conversations.
const { sessionId } = await agent.newSession({
    cwd: process.cwd(),
    mcpServers: [], // mcpServers field not supported yet, but exposed here to maintain conformance with acp protocol
});

// 4. Agent updates are sent via events. You can subscribe to these events to get real-time updates on the agent's progress, tool calls, and more.
const emitter = agent.emitterForSession(sessionId);

emitter.on("agent_message_chunk", (payload) => {
    process.stdout.write(
        payload.content.type === "text"
            ? payload.content.text
            : `[${payload.content.type}]`,
    );
});
emitter.on("agent_thought_chunk", (payload) => {
    process.stdout.write(
        payload.content.type === "text"
            ? payload.content.text
            : `[${payload.content.type}]`,
    );
});
emitter.on("tool_call", (payload) => {
    console.log(`[tool] ${payload.title}`);
});
emitter.on("error", (err) => {
    console.error("[session error]", err);
});

// 5. Send a prompt and wait for completion
const { stopReason } = await agent.prompt({
    sessionId,
    prompt: [{ type: "text", text: "Create a hello world Express server" }],
});

console.log("Done:", stopReason);

// 6. Clean up
await agent.shutdown();

```

## Core Concepts

### Agent Lifecycle

The SDK follows the ACP lifecycle:

```
initialize() → authenticate() → newSession() → prompt() ⇄ events → shutdown()
```

| Step | Method | Purpose |
|------|--------|---------|
| Init | `initialize()` | Exchange protocol version and capabilities |
| Auth | `authenticate()` | OAuth flow for Cline or OpenAI Codex accounts. Optional step if cline config directory already has credentials |
| Session | `newSession()` | Create an isolated conversation context |
| Prompt | `prompt()` | Send user messages; blocks until the turn ends |
| Cancel | `cancel()` | Abort an in-progress prompt turn |
| Mode | `setSessionMode()` | Switch between `"plan"` and `"act"` modes |
| Model | `unstable_setSessionModel()` | Change the backing LLM (experimental) |
| Shutdown | `shutdown()` | Abort all tasks, flush state, release resources |

### Sessions

A session is an independent conversation with its own task history and working directory. You can run multiple sessions concurrently.

```typescript
const { sessionId, modes, models } = await agent.newSession({
  cwd: "/path/to/project",
  mcpServers: [], // mcpServers field not supported yet, but exposed here to maintain conformance with acp protocol
})
```

The response includes:
- `sessionId` — use this in all subsequent calls
- `modes` — available modes (`plan`, `act`) and the current mode
- `models` — available models and the current model ID

Access session metadata via the read-only `sessions` map:

```typescript
const session = agent.sessions.get(sessionId)
// { sessionId, cwd, mode, mcpServers, createdAt, lastActivityAt, ... }
```

### Prompting

`prompt()` sends a user message and blocks until the agent finishes its turn. While the prompt is processing, the agent streams output via session events.

```typescript
const response = await agent.prompt({
  sessionId,
  prompt: [
    { type: "text", text: "Refactor the auth module to use JWT" },
  ],
})
```

The prompt array accepts multiple content blocks:

```typescript
// Text + image + file context
await agent.prompt({
  sessionId,
  prompt: [
    { type: "text", text: "What's in this screenshot?" },
    { type: "image", data: base64ImageData, mimeType: "image/png" },
    {
      type: "resource",
      resource: {
        uri: "file:///path/to/relevant-file.ts",
        mimeType: "text/plain",
        text: fileContents,
      },
    },
  ],
})
```

#### Content Block Types

| Type | Fields | Description |
|------|--------|-------------|
| `TextContent` | `{ type: "text", text: string }` | Plain text message |
| `ImageContent` | `{ type: "image", mimeType: string, data: string }` | Base64-encoded image |
| `EmbeddedResource` | `{ type: "resource", resource: { uri: string, mimeType?: string, text?: string, blob?: string } }` | File or resource context |

#### Stop Reasons

`prompt()` resolves with a `stopReason`:

| Value | Meaning |
|-------|---------|
| `"end_turn"` | Agent finished normally (completed task or waiting for user input) |
| `"error"` | An error occurred |

### Streaming Events

Subscribe to real-time output via `ClineSessionEmitter`. Each session has its own emitter.

```typescript
const emitter = agent.emitterForSession(sessionId)
```

#### Event Types

All events correspond to [ACP `SessionUpdate` types](https://agentclientprotocol.com/protocol/schema#SessionUpdate):

| Event | Payload | Description |
|-------|---------|-------------|
| `agent_message_chunk` | `{ content: ContentBlock }` | Streamed text from the agent |
| `agent_thought_chunk` | `{ content: ContentBlock }` | Internal reasoning / chain-of-thought |
| `tool_call` | `ToolCall` | New tool invocation (file edit, command, etc.) |
| `tool_call_update` | `ToolCallUpdate` | Progress/result update for an existing tool call |
| `plan` | `{ entries: PlanEntry[] }` | Agent's execution plan |
| `available_commands_update` | `{ availableCommands: AvailableCommand[] }` | Slash commands the agent supports |
| `current_mode_update` | `{ currentModeId: string }` | Mode changed (plan/act) |
| `user_message_chunk` | `{ content: ContentBlock }` | User message chunks (for multi-turn) |
| `config_option_update` | `{ configOptions: SessionConfigOption[] }` | Configuration changed |
| `session_info_update` | Session metadata | Session metadata changed |
| `error` | `Error` | Session-level error (not an ACP update) |

```typescript
emitter.on("agent_message_chunk", (payload) => {
  // payload.content is a ContentBlock — usually { type: "text", text: "..." }
  process.stdout.write(payload.content.text)
})

emitter.on("agent_thought_chunk", (payload) => {
  console.log("[thinking]", payload.content.text)
})

emitter.on("tool_call", (payload) => {
  console.log(`[${payload.kind}] ${payload.title} (${payload.status})`)
})

emitter.on("tool_call_update", (payload) => {
  console.log(`  → ${payload.toolCallId}: ${payload.status}`)
})

emitter.on("error", (err) => {
  console.error("Session error:", err)
})
```

The emitter supports `on`, `once`, `off`, and `removeAllListeners`.

### Permission Handling

When the agent wants to execute a tool (edit a file, run a command, etc.), it requests permission. You **must** set a permission handler or all tool calls will be auto-rejected.

```typescript
agent.setPermissionHandler(async (request) => {
  // request.toolCall — details about what the agent wants to do
  // request.options — available choices (allow_once, reject_once, etc.)

  console.log(`Permission requested: ${request.toolCall.title}`)
  console.log("Options:", request.options.map(o => `${o.optionId} (${o.kind})`))

  // Auto-approve everything:
  const allowOption = request.options.find(o => o.kind.includes("allow"))
  if (allowOption) {
    return { outcome: { outcome: "selected", optionId: allowOption.optionId } }
  } else {
    return { outcome: { outcome: "rejected" } }
  }
})
```

#### Permission Options

Each permission request includes an array of `PermissionOption` objects:

| `kind` | Meaning |
|--------|---------|
| `allow_once` | Approve this single operation |
| `allow_always` | Approve and remember for future operations |
| `reject_once` | Deny this single operation |
| `reject_always` | Deny and remember for future operations |

**Important:** If no permission handler is set, all tool calls are rejected for safety.

### Modes

Cline supports two modes:

- **`plan`** — The agent gathers information and creates a plan without executing actions
- **`act`** — The agent executes actions (file edits, commands, etc.)

```typescript
// Switch to plan mode
await agent.setSessionMode({ sessionId, modeId: "plan" })

// Switch back to act mode
await agent.setSessionMode({ sessionId, modeId: "act" })
```

The current mode is returned in `newSession()`

### Model Selection

Change the backing model with `unstable_setSessionModel()`. The model ID format is `"provider/modelId"`.

```typescript
await agent.unstable_setSessionModel({
  sessionId,
  modelId: "anthropic/claude-sonnet-4-20250514",
})
```

This sets the model for both plan and act modes. Available providers include `anthropic`, `openai-native`, `gemini`, `bedrock`, `deepseek`, `mistral`, `groq`, `xai`, and others. Model Ids can be found in the NewSessionResponse object after calling `agent.newSession(..)`

> **Note:** This API is experimental and may change. 

### Authentication

The SDK supports two OAuth flows:

```typescript
// Cline account (uses browser OAuth)
await agent.authenticate({ methodId: "cline-oauth" })

// OpenAI Codex / ChatGPT subscription
await agent.authenticate({ methodId: "openai-codex-oauth" })
```

Both methods open a browser window for the OAuth flow and block until authentication completes (5-minute timeout for Cline OAuth).

For BYO (bring-your-own) API key providers, configure the key through the cline config directory before creating a session. The `authenticate()` call is not needed for BYO providers. We plan to support more auth providers in the near future.

### Cancellation

Cancel an in-progress prompt turn:

```typescript
await agent.cancel({ sessionId })
```

## API Reference

### Constructor

```typescript
new ClineAgent(options: ClineAgentOptions)
```

```typescript
interface ClineAgentOptions {
  /** Enable debug logging (default: false) */
  debug?: boolean
  /** Custom Cline config directory (default: ~/.cline) */
  clineDir?: string
}
```

The `clineDir` option lets you isolate configuration and task history per-application:

```typescript
const agent = new ClineAgent({
  clineDir: "/tmp/my-app-cline",
})
```

### Methods

#### `initialize(params): Promise<InitializeResponse>`

Initialize the agent and negotiate protocol capabilities.

```typescript
const response = await agent.initialize({
  clientCapabilities: {},
  protocolVersion: 1,
})

// Response includes:
{
  protocolVersion: "0.9.0",
  agentCapabilities: {
    loadSession: true,
    promptCapabilities: { image: true, audio: false, embeddedContext: true },
    mcpCapabilities: { http: true, sse: false }
  },
  agentInfo: { name: "cline", version: "2.2.3" },
  authMethods: [
    { id: "cline-oauth", name: "Sign in with Cline", description: "..." },
    { id: "openai-codex-oauth", name: "Sign in with ChatGPT", description: "..." }
  ]
}
```

#### `newSession(params): Promise<NewSessionResponse>`

Create a new conversation session.

```typescript
const session = await agent.newSession({
  cwd: "/path/to/project",
  mcpServers: [
    {
      type: "stdio",
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      env: {},
    },
  ],
})

// Response includes:
{
  sessionId: "uuid-string",
  modes: {
    availableModes: [
      { id: "plan", name: "Plan", description: "Gather information and create a detailed plan" },
      { id: "act", name: "Act", description: "Execute actions to accomplish the task" }
    ],
    currentModeId: "act"
  },
  models: {
    currentModelId: "anthropic/claude-sonnet-4-5-20241022",
    availableModels: [{ modelId: "anthropic/claude-3-5-sonnet-20241022", name: "..." }]
  }
}
```

> **Note:** `newSession()` may throw an auth-required error if credentials are not configured yet.

#### `prompt(params): Promise<PromptResponse>`

Send a user prompt to the agent. This is the main method for interacting with Cline. Blocks until the agent finishes its turn.

```typescript
const response = await agent.prompt({
  sessionId: session.sessionId,
  prompt: [
    { type: "text", text: "Create a function that adds two numbers" },
  ],
})

// Response: { stopReason: "end_turn" | "max_tokens" | "cancelled" | "error" }
```

#### `cancel(params): Promise<void>`

Cancel an ongoing prompt operation.

```typescript
await agent.cancel({ sessionId: session.sessionId })
```

#### `setSessionMode(params): Promise<SetSessionModeResponse>`

Switch between plan and act modes.

```typescript
await agent.setSessionMode({ sessionId, modeId: "plan" })
```

#### `unstable_setSessionModel(params): Promise<SetSessionModelResponse>`

Change the model for the session. Model ID format depends on the inference provider. See NewSessionResponse object to get modelIds.

```typescript
await agent.unstable_setSessionModel({
  sessionId,
  modelId: "anthropic/claude-sonnet-4-20250514",
})
```

#### `authenticate(params): Promise<AuthenticateResponse>`

Authenticate with a provider. Opens a browser window for OAuth flow.

```typescript
await agent.authenticate({ methodId: "cline-oauth" })
```

Current methodIds we support:

| methodId             | Description                   |
| -------------------- | ----------------------------- |
| `cline-oauth`        | use cline inference provider  |
| `openai-codex-oauth` | use your chatgpt subscription |
| more coming soon!... |                               |

#### `shutdown(): Promise<void>`

Clean up all resources. Call this when done.

```typescript
await agent.shutdown()
```

#### `setPermissionHandler(handler)`

Set a callback to handle tool permission requests.

```typescript
agent.setPermissionHandler((request, resolve) => {
  resolve({ outcome: { outcome: "selected", optionId: "allow_once" } })
})
```

#### `emitterForSession(sessionId): ClineSessionEmitter`

Get the typed event emitter for a session.

```typescript
const emitter = agent.emitterForSession(session.sessionId)
```

#### `sessions` (read-only Map)

Access active sessions:

```typescript
for (const [sessionId, session] of agent.sessions) {
  console.log(sessionId, session.cwd, session.mode)
}
```

## Full Example: Auto-Approve Agent

```typescript
import { ClineAgent } from "cline";

async function runTask(taskPrompt: string, cwd: string) {
    const agent = new ClineAgent({ clineDir: "/Users/maxpaulus/.cline" });

    await agent.initialize({
        protocolVersion: 1,
        clientCapabilities: {},
    });

    const { sessionId } = await agent.newSession({ cwd, mcpServers: [] });

    // Auto-approve all tool calls
    agent.setPermissionHandler(async (request) => {
        const allow = request.options.find((o) => o.kind === "allow_once");
        return {
            outcome: allow
                ? { outcome: "selected", optionId: allow.optionId }
                : { outcome: "cancelled" },
        };
    });

    // Collect output
    const output: string[] = [];
    const emitter = agent.emitterForSession(sessionId);

    emitter.on("agent_message_chunk", (p) => {
        if (p.content.type === "text") output.push(p.content.text);
    });

    emitter.on("tool_call", (p) => {
        console.log(`[tool] ${p.title}`);
    });

    const { stopReason } = await agent.prompt({
        sessionId,
        prompt: [{ type: "text", text: taskPrompt }],
    });

    console.log("\n--- Agent Output ---");
    console.log(output.join(""));
    console.log(`\nStop reason: ${stopReason}`);

    await agent.shutdown();
}

runTask("Create a README.md for this project", process.cwd());
```

## Full Example: Interactive Permission Flow

```typescript
import { ClineAgent, type PermissionHandler } from "cline";
import * as readline from "readline";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

const interactivePermissions: PermissionHandler = async (request) => {
    console.log(`\n⚠️  Permission: ${request.toolCall.title}`);

    for (const [i, opt] of request.options.entries()) {
        console.log(`  ${i + 1}. [${opt.kind}] ${opt.name}`);
    }

    const choice = await ask("Choose (number): ");
    const idx = parseInt(choice, 10) - 1;
    const selected = request.options[idx];

    if (selected) {
        return {
            outcome: { outcome: "selected", optionId: selected.optionId },
        };
    } else {
        return { outcome: { outcome: "cancelled" } };
    }
};

async function main() {
    const agent = new ClineAgent({});
    await agent.initialize({ protocolVersion: 1, clientCapabilities: {} });

    const { sessionId } = await agent.newSession({
        cwd: process.cwd(),
        mcpServers: [],
    });

    agent.setPermissionHandler(interactivePermissions);

    const emitter = agent.emitterForSession(sessionId);
    emitter.on("agent_message_chunk", (p) => {
        if (p.content.type === "text") process.stdout.write(p.content.text);
    });

    // Multi-turn conversation
    while (true) {
        const userInput = await ask("\n> ");
        if (userInput === "exit") break;

        const { stopReason } = await agent.prompt({
            sessionId,
            prompt: [{ type: "text", text: userInput }],
        });

        console.log(`\n[${stopReason}]`);
    }

    await agent.shutdown();
    rl.close();
}

main();

```

## Exported Types

All types are re-exported from the `cline` package. Key types:

| Type | Description |
|------|-------------|
| `ClineAgent` | Main agent class |
| `ClineSessionEmitter` | Typed event emitter for session events |
| `ClineAgentOptions` | Constructor options |
| `ClineAcpSession` | Session metadata (read-only) |
| `ClineSessionEvents` | Event name → handler signature map |
| `PermissionHandler` | `(request, resolve) => void` callback |
| `PermissionResolver` | `(response) => void` callback |
| `SessionUpdate` | Union of all session update types |
| `SessionUpdateType` | Discriminator values (`"agent_message_chunk"`, `"tool_call"`, etc.) |
| `ToolCall` | Tool call details (id, title, kind, status, content) |
| `ToolCallUpdate` | Partial update to an existing tool call |
| `ToolCallStatus` | `"pending" \| "in_progress" \| "completed" \| "failed"` |
| `ToolKind` | `"read" \| "edit" \| "delete" \| "execute" \| "search" \| ...` |
| `StopReason` | `"end_turn" \| "cancelled" \| "error" \| "max_tokens" \| ...` |
| `ContentBlock` | `TextContent \| ImageContent \| AudioContent \| ...` |
| `McpServer` | MCP server configuration (stdio, http) |
| `PromptRequest` / `PromptResponse` | Prompt call types |
| `NewSessionRequest` / `NewSessionResponse` | Session creation types |
| `InitializeRequest` / `InitializeResponse` | Initialization types |

See the [ACP Schema](https://agentclientprotocol.com/protocol/schema) for the full type definitions.

## Relationship to ACP

The Cline SDK implements the [Agent Client Protocol](https://agentclientprotocol.com) `Agent` interface. The key difference from a standard ACP stdio agent is that the SDK uses an **event emitter pattern** instead of a transport connection:

| ACP Stdio (via `AcpAgent`) | SDK (via `ClineAgent`) |
|-----------------------------|------------------------|
| Session updates sent over JSON-RPC stdio | Session updates emitted via `ClineSessionEmitter` |
| Permissions requested via `connection.requestPermission()` | Permissions requested via `setPermissionHandler()` callback |
| Single process, single connection | Embeddable, multiple concurrent sessions |

If you need stdio-based ACP communication (e.g., for IDE integration), use the `cline` CLI binary directly. The SDK is for embedding Cline in your own Nodke.js processes.
