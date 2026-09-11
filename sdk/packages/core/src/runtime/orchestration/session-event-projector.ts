/**
 * Session-event projector — Phase 3a of the agent event stream v2
 * design (`docs/agent-event-stream-design.md`). Replaces the v1
 * consumer-side *timing heuristic* (message-translator.ts:2023: "while
 * spawn_agent calls are in flight we also suppress every non-spawn
 * event" — P5) with an explicit routing rule at the producer boundary:
 * every agent event is attributed to an agent path before framing.
 *
 * Rules (deterministic, test-locked):
 * - `parentAgentId` set → the event belongs to the child stream
 *   `["root", <agentId>]` — sub-agent events route structurally, so
 *   consumers prune subtrees via `onSubAgent → null`, never by timing.
 * - `teamAgentId` set (teammates) → `["root", <teamAgentId>]` — a
 *   session-scoped sibling stream keyed by team membership. (agentPath
 *   is a routing key, not a reporting line; "root" prefix denotes
 *   "session-level", not parenthood.)
 * - Neither → the root stream, and `unattributed` flags the case where
 *   the event carried an `agentId` we could not place (older adapters
 *   emit sub-agent events without parentAgentId — the exact hole the
 *   v1 heuristic papered over). Visible to callers; never folklore.
 *
 * Deeper chains (a sub-agent spawning agents) resolve one level at a
 * time as events carry their own parentAgentId; today the SDK emits
 * single-level chains.
 */
import type { CoreSessionEvent } from "../../types/events";
import type { AgentEvent } from "@cline/shared";

export interface ProjectedAgentEvent {
	/** Agent path (root first) the event belongs to. */
	agentPath: string[];
	/** The agent event itself. */
	event: AgentEvent;
	/**
	 * True when the event could not be attributed beyond the root
	 * stream (no parentAgentId, no teamAgentId, but it carried an
	 * agentId). The P5 hole, made visible instead of guessed at.
	 */
	unattributed: boolean;
}

/** Project one CoreSessionEvent; non-agent events project to nothing. */
export function projectSessionEvent(
	event: CoreSessionEvent,
): ProjectedAgentEvent[] {
	if (event.type !== "agent_event") {
		return [];
	}
	const agentEvent: AgentEvent = event.payload.event;
	const parentAgentId = agentEvent.parentAgentId ?? undefined;
	const agentId = agentEvent.agentId ?? undefined;
	const teamAgentId = event.payload.teamAgentId;

	if (parentAgentId !== undefined && agentId !== undefined) {
		return [
			{
				agentPath: ["root", agentId],
				event: agentEvent,
				unattributed: false,
			},
		];
	}
	if (teamAgentId !== undefined) {
		return [
			{
				agentPath: ["root", teamAgentId],
				event: agentEvent,
				unattributed: false,
			},
		];
	}
	return [
		{
			agentPath: ["root"],
			event: agentEvent,
			unattributed: agentId !== undefined,
		},
	];
}
