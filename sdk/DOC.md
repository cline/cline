# SDK API and behavior reference

This file documents exported SDK interfaces whose behavior is not apparent from
their TypeScript declarations. See [ARCHITECTURE.md](./ARCHITECTURE.md) for
runtime ownership and data flow.

## Runtime event hook filters

`AgentRuntimeHooks.onEvent` accepts an `AgentRuntimeOnEventHook`. The hook may
declare an `eventTypes` property containing `AgentRuntimeEvent` discriminants:

```ts
import type { AgentRuntimeOnEventHook } from "@cline/core";

const onEvent: AgentRuntimeOnEventHook = Object.assign(
	async (event) => {
		if (event.type === "message-added") {
			// Handle the message.
		}
	},
	{ eventTypes: ["message-added"] as const },
);
```

The filter is an execution hint for remote runtimes. A Hub-backed runtime checks
the event type before it serializes the event snapshot or sends a capability
request to the client. Local runtimes may call the hook for other event types,
so the hook implementation must still narrow `event.type` before reading
event-specific fields.

Omit `eventTypes` to receive every runtime event. An empty array accepts no
events in a Hub-backed runtime. The Hub rejects unknown event names at the
transport parser. Only an `onEvent` hook contribution can include this filter.
Lifecycle hook contributions such as `beforeRun` and `afterTool` cannot include
it.

`AgentRuntimeEventType`, `AGENT_RUNTIME_EVENT_TYPES`, and
`isAgentRuntimeEventType` are exported by `@cline/shared` for callers that need
to validate configuration before constructing a hook. Hub clients also use
`isAgentRuntimeEvent` to validate the serialized event discriminator, snapshot,
and event-specific required fields before invoking a typed client hook.

## Streaming event durability

The Hub delivers `assistant.delta` and `reasoning.delta` to connected clients
without writing each chunk to the durable event log. These events have no replay
sequence. `assistant.finished` and `reasoning.finished` carry the complete
accumulated content and use the normal durability-before-delivery path.

This prevents a model's token rate from becoming SQLite transaction and `fsync`
rate. Lifecycle, session, approval, capability, tool, and terminal events keep
their existing durable replay semantics and SQLite synchronization settings.
