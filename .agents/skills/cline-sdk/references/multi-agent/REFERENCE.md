# Multi-Agent Coordination

The Cline SDK supports two models for multi-agent work: sub-agents (parent-child) and teams (peer-to-peer).

## Sub-Agents vs Teams

| Feature | Sub-Agents | Teams |
|---------|-----------|-------|
| Enable with | `enableSpawnAgent: true` | `enableAgentTeams: true` |
| Persistence | Session-scoped only | Across sessions |
| Coordination | Parent-child hierarchy | Peer-to-peer |
| Shared state | None | Task board, mailbox, mission log |
| Best for | One-off delegation | Complex multi-session projects |

## Sub-Agents

Sub-agents are spawned by a parent agent during a run. They execute independently and report results back.

### Enabling Sub-Agents

```typescript
const cline = await ClineCore.create({ clientName: "my-app" })

await cline.start({
  prompt: "Refactor the auth module and update tests",
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    enableSpawnAgent: true,
    enableTools: true,
  },
})
```

When `enableSpawnAgent` is true, the agent gets access to sub-agent tools:

| Tool | Description |
|------|-------------|
| `start_subagent` | Spawn a background agent with a task |
| `message_subagent` | Send a message to a running sub-agent |
| `handoff_to_agent` | Delegate the current task entirely |
| `submit_and_exit` | Signal completion |

### How Sub-Agents Work

1. The parent agent decides a subtask can be delegated
2. It calls `start_subagent` with a role, task description, and optionally a preset
3. The sub-agent runs independently in the background
4. The parent can check status or send follow-up messages
5. Sub-agent results are available to the parent when complete

## Teams

Teams provide persistent, cross-session coordination between agents.

### Enabling Teams

```typescript
await cline.start({
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    enableAgentTeams: true,
    teamName: "auth-sprint",
    enableTools: true,
  },
})
```

### Team Tools

When `enableAgentTeams` is true, the coordinator agent gets:

| Tool | Description |
|------|-------------|
| `team_spawn_teammate` | Create a new agent with a role and task |
| `team_delegate_task` | Assign a task to an existing teammate |
| `team_check_status` | Check on a delegated task's progress |
| `team_get_result` | Get the completed result from a teammate |

### Team Persistence

Teams store shared state in:

```
~/.cline/data/teams/[team-name]/
  task-board.json    # task assignments and status
  mailbox.json       # inter-agent messages
  mission-log.json   # coordination log
```

This state persists across sessions, so team members can pick up where they left off.

### CLI Team Access

```bash
cline --team-name auth-sprint "Continue the auth refactor"
```

## Choosing Between Sub-Agents and Teams

Use sub-agents when:
- You need one-off parallel execution within a single session
- Tasks are independent and don't need to communicate with each other
- Results only matter to the parent agent

Use teams when:
- Work spans multiple sessions over time
- Agents need to coordinate and share progress
- Tasks have dependencies between them
- You want a persistent record of multi-agent collaboration

## Patterns

### Parallel Research with Sub-Agents

A parent agent spawns multiple sub-agents to research different topics simultaneously:

```typescript
await cline.start({
  prompt: `Research these three topics in parallel:
    1. Current best practices for JWT auth
    2. OAuth 2.0 provider comparison
    3. Session management patterns
    Spawn a sub-agent for each topic, then synthesize the results.`,
  config: {
    enableSpawnAgent: true,
    enableTools: true,
    // ...
  },
})
```

### Team Sprint

A coordinator manages a multi-session project:

```typescript
await cline.start({
  prompt: `You are the coordinator for the auth-sprint team.
    Review the task board and delegate the next highest-priority task
    to a teammate. Check status on any in-progress tasks.`,
  config: {
    enableAgentTeams: true,
    teamName: "auth-sprint",
    enableTools: true,
    // ...
  },
})
```

## See Also

- `../clinecore/REFERENCE.md` - ClineCore runtime
- `../clinecore/api.md` - Session config for teams
- `../tools/REFERENCE.md` - Tool system
- `../plugins/REFERENCE.md` - Plugin system
