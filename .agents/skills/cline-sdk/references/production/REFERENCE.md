# Going to Production

Guidelines for deploying Cline SDK agents in production environments.

## Error Handling

Always check the result status:

```typescript
const result = await agent.run(input)

switch (result.status) {
  case "completed":
    console.log("Success:", result.outputText)
    break
  case "aborted":
    console.log("Cancelled:", result.error?.message)
    break
  case "failed":
    console.error("Failed:", result.error)
    break
}
```

For ClineCore, check `finishReason`:

```typescript
const session = await cline.start({ ... })

switch (session.result?.finishReason) {
  case "completed":
    // normal completion
    break
  case "max_iterations":
    // agent hit iteration limit
    break
  case "aborted":
    // manually cancelled
    break
  case "mistake_limit":
    // too many tool errors
    break
  case "error":
    // unrecoverable error
    break
}
```

## Cost Control

### Token Limits

Set maximum tokens per turn and iteration limits:

```typescript
const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  maxTokensPerTurn: 4096,
  maxIterations: 10,
  tools: [...],
})
```

### Model Selection

Use cheaper models for simple tasks:

```typescript
// Simple classification or formatting
{ providerId: "anthropic", modelId: "claude-haiku-4-5" }

// Complex reasoning and code generation
{ providerId: "anthropic", modelId: "claude-sonnet-4-6" }

// Hardest tasks requiring deep reasoning
{ providerId: "anthropic", modelId: "claude-opus-4-7" }
```

### Usage Tracking

Monitor spending in real time:

```typescript
agent.subscribe((event) => {
  if (event.type === "usage-updated" && event.usage.totalCost) {
    if (event.usage.totalCost > MAX_BUDGET) {
      agent.abort("Budget exceeded")
    }
  }
})
```

## Observability

### OpenTelemetry Integration

The SDK supports OpenTelemetry for traces, metrics, and logs:

```typescript
import { ClineCore } from "@cline/sdk"

const cline = await ClineCore.create({
  clientName: "my-app",
  // OpenTelemetry config is picked up from environment
  // OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_SERVICE_NAME, etc.
})
```

### Structured Logging

Use the `BasicLogger` interface for injectable logging:

```typescript
import type { BasicLogger } from "@cline/sdk"

const logger: BasicLogger = {
  debug: (msg, meta) => console.debug(msg, meta),
  log: (msg, meta) => console.log(msg, meta),
  error: (msg, meta) => console.error(msg, meta),
}

await cline.start({
  config: {
    logger,
    // ...
  },
})
```

### Custom Metrics via Plugins

```typescript
const metricsPlugin: AgentPlugin = {
  name: "metrics",
  manifest: { capabilities: ["hooks"] },
  setup() {},
  hooks: {
    beforeRun() {
      metrics.increment("agent.runs.started")
    },
    afterRun({ result }) {
      metrics.increment("agent.runs.completed")
      metrics.histogram("agent.iterations", result.iterations)
      metrics.histogram("agent.tokens.output", result.usage.outputTokens)
    },
    beforeTool({ toolCall }) {
      metrics.increment(`agent.tools.${toolCall.toolName}`)
    },
  },
}
```

## Security

### Sandbox Tool Execution

Validate tool inputs to prevent path traversal and injection:

```typescript
execute: async (input) => {
  const safePath = path.resolve(WORKSPACE_ROOT, input.path)
  if (!safePath.startsWith(WORKSPACE_ROOT)) {
    return { error: "Path traversal attempt blocked" }
  }
  return await readFile(safePath, "utf-8")
}
```

### API Key Management

- Use environment variables, never hardcode keys
- Rotate keys regularly
- Use different keys for development and production

```typescript
{
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  apiKey: process.env.ANTHROPIC_API_KEY, // never a literal string
}
```

### Tool Policy Hardening

Disable tools you don't need and require approval for dangerous ones:

```typescript
toolPolicies: {
  read_files: { autoApprove: true },
  search: { autoApprove: true },
  bash: { autoApprove: false },     // require approval
  editor: { autoApprove: false },
  apply_patch: { autoApprove: false },
  fetch_web: { enabled: false },    // disable entirely
}
```

## Deployment Patterns

### Stateless Worker

For request/response workloads (API endpoints, queue consumers):

```typescript
const cline = await ClineCore.create({
  clientName: "worker",
  backendMode: "local",
})

app.post("/agent", async (req, res) => {
  const session = await cline.start({
    prompt: req.body.prompt,
    config: { ... },
  })
  res.json({ text: session.result?.text, usage: session.result?.usage })
})
```

### Persistent Service

For long-running services with session management:

```typescript
const cline = await ClineCore.create({
  clientName: "service",
  backendMode: "hub",
})

process.on("SIGTERM", async () => {
  await cline.dispose("SIGTERM")
  process.exit(0)
})
```

### Scheduled Automation

See `../scheduling/REFERENCE.md` for recurring agent tasks.

## Retry and Resilience

- Tool `execute` functions support `retryable: true` (default) and `maxRetries: 3` (default)
- Provider API calls are retried automatically on transient failures
- Use `timeoutMs` on tools to prevent hanging
- Monitor `mistake_limit` finish reason to detect systematic tool failures

## See Also

- `../agent/REFERENCE.md` - Agent overview
- `../clinecore/REFERENCE.md` - ClineCore overview
- `../tools/REFERENCE.md` - Tool configuration
- `../plugins/REFERENCE.md` - Metrics plugins
- `../scheduling/REFERENCE.md` - Scheduled agents
