# Tools

Tools are how agents interact with the world. The Cline SDK supports both built-in tools (via ClineCore) and custom tools you define yourself.

## Creating Custom Tools

Use `createTool()` from `@cline/sdk` (or `@cline/shared`):

```typescript
import { createTool } from "@cline/sdk"

const myTool = createTool({
  name: "search_issues",
  description: "Search GitHub issues by query. Returns up to 10 results.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      state: { type: "string", enum: ["open", "closed", "all"] },
    },
    required: ["query"],
  },
  execute: async (input) => {
    const issues = await github.searchIssues(input.query, input.state)
    return { issues, count: issues.length }
  },
})
```

### With Zod Schema

```typescript
import { createTool } from "@cline/sdk"
import { z } from "zod"

const deployTool = createTool({
  name: "deploy",
  description: "Deploy the app to the specified environment.",
  inputSchema: z.object({
    environment: z.enum(["staging", "production"]).describe("Target environment"),
    version: z.string().optional().describe("Version tag, defaults to latest"),
  }),
  execute: async (input) => {
    const result = await deploy(input.environment, input.version)
    return { url: result.url, status: "deployed" }
  },
})
```

### Tool Config Options

```typescript
createTool({
  name: string,                         // snake_case, unique per agent
  description: string,                  // what the tool does (model reads this)
  inputSchema: JSONSchema | ZodSchema,  // input validation
  execute: async (input, context, onChange?) => output,
  timeoutMs?: number,                   // default: 30000
  retryable?: boolean,                  // default: true
  maxRetries?: number,                  // default: 3
  lifecycle?: {
    completesRun?: boolean              // true = ends agent loop on success
  },
})
```

### AgentToolContext

The second argument to `execute` provides runtime context:

```typescript
interface AgentToolContext {
  agentId: string
  conversationId: string
  iteration: number
  abortSignal?: AbortSignal
  metadata?: Record<string, unknown>
}
```

## Tool Naming Rules

- Names must be `snake_case` (e.g., `search_issues`, `deploy_app`)
- Names must be unique within a single agent's tool set
- Choose descriptive names since the model uses them to decide which tool to call

## Tool Descriptions Matter

The model reads the tool description to decide when and how to use it. Write clear, specific descriptions:

```typescript
// Bad: vague
description: "Does deployment stuff"

// Good: specific with constraints
description: "Deploy the application to staging or production. " +
  "Staging deployments are immediate. Production requires a passing CI build. " +
  "Returns the deployment URL and status."
```

Include constraints, rate limits, and expected behavior in the description.

## Error Handling in Tools

Return errors as structured data instead of throwing:

```typescript
// Good: return error data
execute: async (input) => {
  const file = await readFile(input.path).catch(() => null)
  if (!file) {
    return { error: "File not found", path: input.path }
  }
  return { content: file }
}
```

Thrown exceptions count as "mistakes" against the agent's mistake limit. Returned error data lets the agent adjust its approach.

## Completion Tools

Tools with `lifecycle: { completesRun: true }` end the agent loop when they execute successfully:

```typescript
const submitAnswer = createTool({
  name: "submit_answer",
  description: "Submit the final answer and end the task.",
  inputSchema: z.object({
    answer: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  lifecycle: { completesRun: true },
  execute: async (input) => input,
})
```

The model sees the tool result and the run ends. Access the output via `result.toolCalls`.

## Built-in Tools (ClineCore Only)

When using `ClineCore` with `enableTools: true`, these tools are available automatically:

| Tool | Name | What It Does |
|------|------|-------------|
| Shell | `bash` | Execute shell commands in the session workspace |
| Editor | `editor` | Create and edit files |
| Read | `read_files` | Read file contents |
| Patch | `apply_patch` | Apply unified diffs to files |
| Search | `search` | Search file contents and directory structure |
| Web | `fetch_web` | Fetch web content via HTTP |

Built-in tools respect the `cwd` setting in `CoreSessionConfig`.

## Tool Policies

Control which tools are available and whether they require approval:

```typescript
// In Agent config
const agent = new Agent({
  tools: [toolA, toolB, toolC],
  toolPolicies: {
    tool_a: { autoApprove: true },    // runs without asking
    tool_b: { autoApprove: false },   // requires approval
    tool_c: { enabled: false },       // hidden from model
  },
})

// In ClineCore session
await cline.start({
  prompt: "...",
  config: { ... },
  toolPolicies: {
    bash: { autoApprove: true },
    editor: { autoApprove: false },
  },
})
```

### Policy Options

| Policy | Effect |
|--------|--------|
| `{ autoApprove: true }` | Tool runs without approval |
| `{ autoApprove: false }` | Triggers approval callback before running |
| `{ enabled: false }` | Tool is hidden from the model entirely |
| No policy set | Defaults to enabled and auto-approved |

## Abort Signal in Long-Running Tools

Respect the abort signal for tools that take a long time:

```typescript
execute: async (input, context) => {
  const results = []
  for (const item of input.items) {
    if (context.abortSignal?.aborted) {
      return { results, aborted: true, processed: results.length }
    }
    results.push(await processItem(item))
  }
  return { results, processed: results.length }
}
```

## Streaming Tool Output

Use the `onChange` callback (third argument) to stream partial results:

```typescript
execute: async (input, context, onChange) => {
  let progress = 0
  for (const step of steps) {
    progress++
    onChange?.(`Processing step ${progress}/${steps.length}...`)
    await processStep(step)
  }
  return { completed: true }
}
```

## Testing Tools

Tools are plain async functions, so they're straightforward to test:

```typescript
import { describe, it, expect } from "vitest"

describe("deploy tool", () => {
  it("deploys to staging", async () => {
    const context = { agentId: "test", conversationId: "test", iteration: 1 }
    const result = await deployTool.execute({ environment: "staging" }, context)
    expect(result.status).toBe("deployed")
  })
})
```

## MCP Tool Integration

ClineCore can connect to MCP (Model Context Protocol) servers for additional tools. Configure in `.cline/mcp-servers.json`:

```json
{
  "servers": {
    "my-server": {
      "command": "node",
      "args": ["./mcp-server.js"]
    }
  }
}
```

MCP tools appear alongside built-in and custom tools automatically.

## See Also

- `../agent/REFERENCE.md` - Using tools with Agent
- `../clinecore/REFERENCE.md` - Using tools with ClineCore
- `../plugins/REFERENCE.md` - Packaging tools as plugins
