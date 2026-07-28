# Multi-Agent Coordination

The Cline SDK supports three models for multi-agent work: sub-agents (parent-child), teams (peer-to-peer agents inside one runtime), and session mail (peer-to-peer between whole sessions).

## Sub-Agents vs Teams vs Session Mail

| Feature | Sub-Agents | Teams | Session Mail |
|---------|-----------|-------|--------------|
| Enable with | `enableSpawnAgent: true` | `enableAgentTeams: true` | Always on |
| Addresses | Child agents | Agents in one `AgentTeamsRuntime` | Whole sessions, by `sessionId` |
| Persistence | Session-scoped only | Across sessions | Durable store, survives restarts |
| Coordination | Parent-child hierarchy | Peer-to-peer | Peer-to-peer |
| Shared state | None | Task board, mailbox, mission log | Per-session inbox |
| Best for | One-off delegation | Complex multi-session projects | Handoffs between separately started sessions |

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

## Session Mail

Teams address agents inside one runtime. Session mail addresses whole sessions, so two independently started top-level agents can hand work to each other.

### Availability

Session mail is always on — there is no enable flag. Every session can be addressed by its peers, so the tools are present whenever the runtime host supplies a messenger. To withhold them from a specific session, add `session_messaging` to `disabledToolIds`.

### Session Mail Tools

| Tool | Description |
|------|-------------|
| `session_list_peers` | List other sessions and whether each is live right now |
| `session_send_message` | Send a message to another session by `sessionId` |
| `session_read_inbox` | Read messages sent to this session |

### Delivery

Every message is written to a durable store (`session-mail.db`, or an append-only `mail.jsonl` when SQLite is unavailable) *before* delivery, then handed to the target's pending-prompt queue:

- `delivery: "queue"` (default) — runs after the target's current work.
- `delivery: "steer"` — interrupts the target's current turn.

A live target is woken immediately and processes the message as a user turn. A target that is not running keeps the message pending; it is drained on that session's next start.

### Routing

Routing is owned by the `LocalRuntimeHost` that hosts the sessions, not by the hub protocol — there is no session-mail RPC.

- **Under the hub**, `HubRuntimeHost` does not host sessions; it forwards `session.create` to the daemon, which runs a single `LocalRuntimeHost` for every session. Delivery between any two hub sessions is an in-process enqueue on that host.
- **Standalone cores** each host only their own sessions. A message to a session in another process cannot be delivered live, so it stays pending until that session next starts.

### Loop Guards

Because delivery auto-resumes the target, the SDK bounds message chains:

- **Hop limit** (default 3) — each message-triggered wakeup increments `hopCount`; sends past the limit are refused.
- **Cycle detection** — a send to any session already in the chain is refused outright.
- **Rate limit** (default 20 per minute per session).

Override via `SessionMessengerOptions.limits`. Refusals throw `SessionMessageRejectedError` with a `reason` of `self_send`, `unknown_peer`, `hop_limit`, `cycle`, or `rate_limit`.

### Programmatic Use

```typescript
import { SessionMessenger, createLocalSessionMailStore } from "@cline/sdk"

const messenger = new SessionMessenger({
  store: createLocalSessionMailStore(),
  directory: { getSession, listSessions },
  target: { deliver: async ({ sessionId, prompt, delivery }) => true },
})

await messenger.send({
  fromSessionId: "abc",
  toSessionId: "xyz",
  subject: "handoff",
  body: "Auth refactor is merged; please rerun the integration suite.",
})
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
