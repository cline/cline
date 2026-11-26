import { EventEmitter } from "node:events";
import type {
	AgentEvent,
	CoreSessionEvent,
	RuntimeHostSubscribeOptions,
	TeamEvent,
} from "@cline/core";

export const getUIEventEmitter = () =>
	new EventEmitter() as InteractiveEventBridge;

export interface PendingPromptSnapshot {
	sessionId: string;
	prompts: Array<{
		id: string;
		prompt: string;
		delivery: "queue" | "steer";
		attachmentCount: number;
	}>;
}

export interface PendingPromptSubmittedEvent {
	sessionId: string;
	id: string;
	prompt: string;
	delivery: "queue" | "steer";
	attachmentCount: number;
}

interface InteractiveEventBridge {
	on(event: "agent", listener: (event: AgentEvent) => void): this;
	on(event: "team", listener: (event: TeamEvent) => void): this;
	on(
		event: "pending-prompts",
		listener: (event: PendingPromptSnapshot) => void,
	): this;
	on(
		event: "pending-prompt-submitted",
		listener: (event: PendingPromptSubmittedEvent) => void,
	): this;
	off(event: "agent", listener: (event: AgentEvent) => void): this;
	off(event: "team", listener: (event: TeamEvent) => void): this;
	off(
		event: "pending-prompts",
		listener: (event: PendingPromptSnapshot) => void,
	): this;
	off(
		event: "pending-prompt-submitted",
		listener: (event: PendingPromptSubmittedEvent) => void,
	): this;
	emit(event: "agent", payload: AgentEvent): boolean;
	emit(event: "team", payload: TeamEvent): boolean;
	emit(event: "pending-prompts", payload: PendingPromptSnapshot): boolean;
	emit(
		event: "pending-prompt-submitted",
		payload: PendingPromptSubmittedEvent,
	): boolean;
}

type SessionManagerSubscriber = {
	subscribe(
		listener: (event: unknown) => void,
		options?: RuntimeHostSubscribeOptions,
	): () => void;
};

type AgentDoneEvent = Extract<AgentEvent, { type: "done" }>;

function doneEventCompletenessScore(event: AgentDoneEvent): number {
	let score = 0;
	if (typeof event.text === "string" && event.text.trim().length > 0) {
		score += 2;
	}
	if (typeof event.iterations === "number" && event.iterations > 0) {
		score += 2;
	}
	if (event.usage) {
		score += 3;
	}
	if (event.reason !== "completed") {
		score += 1;
	}
	return score;
}

function isDelegationTool(toolName: string | undefined): boolean {
	return toolName === "spawn_agent" || !!toolName?.startsWith("subagent_");
}

/**
 * Subagents stream into the parent's event feed and run concurrently, so
 * their per-delta text and reasoning would interleave into one garbled
 * message. The parent never streams while its delegation tool calls are in
 * flight, so any delta arriving then belongs to a child: drop the fragments
 * and surface each child's message whole at `content_end`, which already
 * carries the full text.
 */
function createDelegatedContentCoalescer(): (
	event: AgentEvent,
) => AgentEvent[] {
	const openDelegations = new Set<string>();
	return (event) => {
		if (event.type === "content_start" && event.contentType === "tool") {
			if (isDelegationTool(event.toolName) && event.toolCallId) {
				openDelegations.add(event.toolCallId);
			}
			return [event];
		}
		if (event.type === "content_end" && event.contentType === "tool") {
			if (event.toolCallId) openDelegations.delete(event.toolCallId);
			return [event];
		}
		// Completed delegations are closed by their tool content_end; an aborted
		// or failed run may never emit those, so drop the stale bookkeeping.
		if (event.type === "done" && event.reason !== "completed") {
			openDelegations.clear();
			return [event];
		}
		if (openDelegations.size === 0) return [event];
		if (event.type === "content_start") {
			return event.contentType === "text" || event.contentType === "reasoning"
				? []
				: [event];
		}
		if (event.type === "content_end" && event.contentType === "text") {
			if (!event.text) return [event];
			return [
				{ type: "content_start", contentType: "text", text: event.text },
				event,
			];
		}
		if (event.type === "content_end" && event.contentType === "reasoning") {
			if (!event.reasoning) return [event];
			return [
				{
					type: "content_start",
					contentType: "reasoning",
					reasoning: event.reasoning,
				},
				event,
			];
		}
		return [event];
	};
}

export function subscribeToAgentEvents(
	sessionManager: SessionManagerSubscriber,
	onAgentEvent: (event: AgentEvent) => void,
	options?: RuntimeHostSubscribeOptions,
): () => void {
	let hasSeenStructuredAgentEvent = false;
	let lastDoneEvent: AgentDoneEvent | undefined;
	const coalesceDelegatedContent = createDelegatedContentCoalescer();
	const emitAgentEvent = (rawEvent: AgentEvent): void => {
		for (const event of coalesceDelegatedContent(rawEvent)) {
			emitDedupedAgentEvent(event);
		}
	};
	const emitDedupedAgentEvent = (event: AgentEvent): void => {
		if (event.type === "iteration_start") {
			lastDoneEvent = undefined;
		}
		if (event.type === "done") {
			if (
				lastDoneEvent &&
				doneEventCompletenessScore(event) <=
					doneEventCompletenessScore(lastDoneEvent)
			) {
				return;
			}
			lastDoneEvent = event;
		}
		onAgentEvent(event);
	};
	return sessionManager.subscribe((event: unknown) => {
		const typedEvent = event as
			| { type: "agent_event"; payload: { event: AgentEvent } }
			| { type: "chunk"; payload: { stream: string; chunk: string } }
			| { type: string; payload?: unknown };
		if (typedEvent.type === "agent_event") {
			hasSeenStructuredAgentEvent = true;
			const payload = typedEvent.payload as
				| { event?: AgentEvent; teamRole?: string }
				| undefined;
			// Skip teammate output because it would interleave with lead output on
			// shared stdout, but keep usage events so session totals update live.
			if (
				payload?.event &&
				(payload.teamRole !== "teammate" || payload.event.type === "usage")
			) {
				emitAgentEvent(payload.event);
			}
			return;
		}

		const chunkEvent = event as
			| { type: "chunk"; payload: { stream: string; chunk: string } }
			| { type: string; payload?: unknown };
		if (
			chunkEvent.type !== "chunk" ||
			!chunkEvent.payload ||
			typeof chunkEvent.payload !== "object"
		) {
			return;
		}
		if (hasSeenStructuredAgentEvent) {
			return;
		}
		const payload = chunkEvent.payload as { stream?: string; chunk?: string };
		if (payload.stream !== "agent" || typeof payload.chunk !== "string") {
			return;
		}
		try {
			emitAgentEvent(JSON.parse(payload.chunk) as AgentEvent);
		} catch {
			// Best-effort event parsing path.
		}
	}, options);
}

export function subscribeToPendingPromptEvents(
	sessionManager: SessionManagerSubscriber,
	handlers: {
		onPendingPrompts: (event: PendingPromptSnapshot) => void;
		onPendingPromptSubmitted: (event: PendingPromptSubmittedEvent) => void;
	},
): () => void {
	return sessionManager.subscribe((event: unknown) => {
		const typedEvent = event as CoreSessionEvent;
		if (typedEvent.type === "pending_prompts") {
			handlers.onPendingPrompts(typedEvent.payload);
			return;
		}
		if (typedEvent.type === "pending_prompt_submitted") {
			handlers.onPendingPromptSubmitted(typedEvent.payload);
		}
	});
}
