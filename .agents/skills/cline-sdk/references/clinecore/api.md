# ClineCore API Reference

## Creating ClineCore

```typescript
import { ClineCore } from "@cline/sdk"

const cline = await ClineCore.create(options: ClineCoreOptions)
```

### ClineCoreOptions

```typescript
interface ClineCoreOptions {
  clientName: string                     // identifies your app
  distinctId?: string                    // user/instance identifier
  backendMode?: "auto" | "local" | "hub" | "remote"
  hub?: HubOptions
  remote?: RemoteOptions
  capabilities?: RuntimeCapabilities
  toolPolicies?: Record<string, ToolPolicy>
  automation?: boolean | ClineCoreAutomationOptions
  fetch?: typeof fetch
}
```

### RuntimeCapabilities

```typescript
interface RuntimeCapabilities {
  requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult>
  // ... other capability callbacks
}
```

## Starting Sessions

### start(input)

```typescript
const session = await cline.start(input: ClineCoreStartInput)
```

Returns a `StartSessionResult`:

```typescript
interface StartSessionResult {
  sessionId: string
  manifest: SessionManifest
  manifestPath: string
  messagesPath: string
  result?: AgentResult
}
```

### ClineCoreStartInput

```typescript
interface ClineCoreStartInput {
  prompt: string
  config: CoreSessionConfig
  source?: string
  interactive?: boolean
  sessionMetadata?: Record<string, unknown>
  initialMessages?: AgentMessage[]
  toolPolicies?: Record<string, ToolPolicy>
  capabilities?: RuntimeCapabilities
}
```

### CoreSessionConfig

```typescript
interface CoreSessionConfig {
  cwd?: string                          // working directory
  providerId: string                    // LLM provider
  modelId: string                       // model identifier
  apiKey?: string                       // provider API key
  systemPrompt?: string                 // custom system prompt
  tools?: readonly AgentTool[]          // additional custom tools
  enableTools?: boolean                 // enable built-in tools
  hooks?: Partial<AgentRuntimeHooks>    // runtime hooks
  extensions?: AgentPlugin[]            // plugins loaded inline
  pluginPaths?: string[]                // paths to plugin packages
  extensionLoading?: "isolated" | "direct"
  extensionContext?: {                  // context passed to plugin setup()
    workspace?: { rootPath: string; cwd: string }
  }
  checkpointConfig?: CoreCheckpointConfig
  compactionConfig?: CoreCompactionConfig
  telemetry?: ITelemetryService
  logger?: BasicLogger
  enableSpawnAgent?: boolean            // enable sub-agent spawning
  enableAgentTeams?: boolean            // enable team coordination
  teamName?: string                     // team identifier
}
```

`extensions` passes plugin objects directly. `pluginPaths` points to directories with `package.json` containing a `cline.plugins` field. Set `extensionContext.workspace` so plugins receive `ctx.workspaceInfo` in their `setup()` call -- without it, `ctx.workspaceInfo` is undefined.

## Follow-Up Messages

### send({ sessionId, prompt })

Send a follow-up message to an existing session:

```typescript
const result = await cline.send({
  sessionId: session.sessionId,
  prompt: "Now add authentication",
})
```

Returns `AgentResult | undefined`.

## Event Subscription

### subscribe(listener, options?)

```typescript
const unsubscribe = cline.subscribe(
  (event: CoreSessionEvent) => {
    // handle events
  },
  { sessionId: "optional-filter" }
)
```

### CoreSessionEvent

```typescript
type CoreSessionEvent =
  | { type: "chunk"; payload: SessionChunkEvent }
  | { type: "agent_event"; payload: { sessionId: string, event: AgentEvent } }
  | { type: "ended"; payload: SessionEndedEvent }
  | { type: "team_progress"; payload: SessionTeamProgressEvent }
  | { type: "status"; payload: { sessionId: string, status: string } }
  | { type: "hook"; payload: SessionToolEvent }
```

## Session Management

### list(limit?, options?)

```typescript
const sessions: SessionRecord[] = await cline.list(50)
```

### get(sessionId)

```typescript
const session: SessionRecord = await cline.get(sessionId)
```

### readMessages(sessionId)

```typescript
const messages: AgentMessage[] = await cline.readMessages(sessionId)
```

### getAccumulatedUsage(sessionId)

```typescript
const usage = await cline.getAccumulatedUsage(sessionId)
// usage.usage - root agent only
// usage.aggregateUsage - root + subagents/teammates
```

### update(sessionId, updates)

```typescript
await cline.update(sessionId, { title: "New title" })
```

### abort(sessionId, reason?)

```typescript
await cline.abort(sessionId, "User cancelled")
```

### stop(sessionId)

```typescript
await cline.stop(sessionId)
```

### delete(sessionId)

```typescript
await cline.delete(sessionId)
```

### restore(input)

Restore a session from a checkpoint:

```typescript
await cline.restore({ sessionId, checkpointId })
```

### dispose(reason?)

Clean up all resources. Always call this when done:

```typescript
await cline.dispose("Shutting down")
```

## AgentResult

Returned by session operations:

```typescript
interface AgentResult {
  text: string
  usage: LegacyAgentUsage
  messages: MessageWithMetadata[]
  toolCalls: ToolCallRecord[]
  iterations: number
  finishReason: "completed" | "max_iterations" | "aborted" | "mistake_limit" | "error"
  model: { id: string; provider: string; info?: ModelInfo }
  startedAt: Date
  endedAt: Date
  durationMs: number
}
```

## Tool Policies

Control tool access at the session level:

```typescript
const session = await cline.start({
  prompt: "Review the code",
  config: { ... },
  toolPolicies: {
    read_files: { autoApprove: true },
    bash: { autoApprove: false },
    editor: { enabled: false },
  },
})
```

### ToolPolicy

```typescript
interface ToolPolicy {
  enabled?: boolean       // false = tool is hidden from the model
  autoApprove?: boolean   // false = requires approval callback
}
```

## Interactive Approval

```typescript
const cline = await ClineCore.create({
  clientName: "my-app",
  capabilities: {
    requestToolApproval: async (request) => {
      console.log(`Tool: ${request.toolName}, Input: ${JSON.stringify(request.input)}`)
      const approved = await askUser(`Allow ${request.toolName}?`)
      return { approved }
    },
  },
})
```

## Automation API

When `automation` is enabled in `ClineCore.create()`:

```typescript
const cline = await ClineCore.create({
  clientName: "my-app",
  automation: true,
})

// Access automation methods
cline.automation.start()
cline.automation.stop()
cline.automation.reconcile(specs)
cline.automation.ingestEvent(event)
cline.automation.listEvents()
cline.automation.listSpecs()
cline.automation.listRuns()
```

## Settings API

```typescript
// Read settings
const settings = await cline.settings.list()

// Toggle tools, plugins, MCP servers
await cline.settings.toggle({ type: "tool", name: "bash", enabled: true })
```

## See Also

- `REFERENCE.md` - Overview and quick start
- `patterns.md` - Common patterns
- `gotchas.md` - Pitfalls
- `../tools/REFERENCE.md` - Tool creation
- `../plugins/REFERENCE.md` - Plugin system
