# Scheduling and Automation

The Cline SDK supports scheduled, one-off, and event-driven agent execution through the automation subsystem in `@cline/core`.

## Overview

Three trigger types:

| Trigger | Description |
|---------|-------------|
| `schedule` | Recurring jobs via cron expressions |
| `one_off` | Single execution tasks |
| `event` | Triggered by external events (GitHub, Linear, custom) |

## CLI Schedule Management

```bash
# Create a recurring schedule
cline schedule create "Daily standup" \
  --cron "0 9 * * MON-FRI" \
  --prompt "Summarize open PRs and blockers" \
  --workspace /path/to/project \
  --model anthropic/claude-sonnet-4-6

# List schedules
cline schedule list

# Trigger a schedule immediately
cline schedule trigger <schedule-id>

# Pause/resume
cline schedule pause <schedule-id>
cline schedule resume <schedule-id>

# Delete
cline schedule delete <schedule-id>

# View past executions
cline schedule executions <schedule-id>
```

## Cron Expressions

| Expression | Meaning |
|-----------|---------|
| `0 9 * * MON-FRI` | 9 AM weekdays |
| `0 */6 * * *` | Every 6 hours |
| `0 8 * * MON` | Mondays at 8 AM |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 1 * *` | First of every month |

## File-Based Specs

Create Markdown files in `~/.cline/cron/` (global) or `.cline/cron/` (workspace):

### Recurring Schedule

```markdown
---
trigger: schedule
schedule: "0 9 * * MON-FRI"
timezone: America/New_York
mode: exclusive
prompt: "Check for dependency updates and create PRs for any outdated packages."
modelSelection:
  providerId: anthropic
  modelId: claude-sonnet-4-6
tools:
  enabled: true
---

Additional context or instructions for the agent go in the body.
```

### One-Off Task

```markdown
---
trigger: one_off
prompt: "Generate a comprehensive test coverage report."
modelSelection:
  providerId: anthropic
  modelId: claude-sonnet-4-6
---
```

### Event-Driven

```markdown
---
trigger: event
eventType: github.pull_request.opened
filters:
  repository: myorg/myrepo
debounceMs: 5000
cooldownMs: 60000
prompt: "Review the PR for security issues and code quality."
modelSelection:
  providerId: anthropic
  modelId: claude-sonnet-4-6
---
```

## CronSpec Types

```typescript
interface CronScheduleSpec {
  trigger: "schedule"
  schedule: string              // cron expression
  timezone?: string
  mode?: "exclusive" | "concurrent"
  prompt: string
  modelSelection?: { providerId: string; modelId?: string }
  extensionLoading?: "isolated" | "direct"
  configExtensions?: RuntimeConfigExtensionKind[]
  tools?: { enabled?: boolean; names?: string[] }
}

interface CronOneOffSpec {
  trigger: "one_off"
  prompt: string
  modelSelection?: { providerId: string; modelId?: string }
}

interface CronEventSpec {
  trigger: "event"
  eventType: string             // e.g., "github.pull_request.opened"
  filters?: Record<string, unknown>
  debounceMs?: number
  cooldownMs?: number
  prompt: string
  modelSelection?: { providerId: string; modelId?: string }
}
```

## Programmatic Automation API

```typescript
const cline = await ClineCore.create({
  clientName: "my-app",
  automation: true,
})

// Start automation service
cline.automation.start()

// Ingest an external event
cline.automation.ingestEvent({
  eventId: "evt-123",
  eventType: "github.pull_request.opened",
  source: "github",
  timestamp: Date.now(),
  payload: { pr: { number: 42, title: "..." } },
})

// List specs, runs, events
const specs = await cline.automation.listSpecs()
const runs = await cline.automation.listRuns()
const events = await cline.automation.listEvents()

// Reconcile specs from directory
await cline.automation.reconcile(specDirectory)

// Stop automation
cline.automation.stop()
```

## Event Ingestion from Plugins

Plugins can declare and emit automation events:

```typescript
const webhookPlugin: AgentPlugin = {
  name: "webhook-events",
  manifest: { capabilities: ["automationEvents"] },
  setup(api) {
    api.registerAutomationEventType({
      type: "webhook.received",
      description: "External webhook received",
    })
  },
}
```

Submit events via the plugin context:

```typescript
ctx.automation.ingestEvent({
  eventId: "evt-456",
  eventType: "webhook.received",
  source: "custom",
  timestamp: Date.now(),
  payload: { ... },
})
```

## Concurrency Control

| Mode | Behavior |
|------|----------|
| `"exclusive"` | Skip if previous run still active |
| `"concurrent"` | Allow overlapping runs |

## Run Reports

Each completed run writes a Markdown report to `.cline/cron/reports/<run-id>.md` with:
- Run metadata (spec, trigger, timing)
- Summary of agent output
- Usage (tokens, cost)
- Tool calls made
- Trigger event context (for event-driven runs)

## Use Cases

- Daily standup summaries
- Automated dependency update checks
- PR review on open
- Codebase health reports
- Scheduled security scans
- Event-driven CI/CD workflows

## See Also

- `../clinecore/REFERENCE.md` - ClineCore runtime
- `../clinecore/api.md` - Automation API details
- `../plugins/REFERENCE.md` - Plugin events
- `../production/REFERENCE.md` - Production deployment
