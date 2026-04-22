import { EventEmitter } from "node:events";
import type {
	AgentEvent,
	CoreSessionEvent,
	RuntimeHostSubscribeOptions,
	TeamEvent,
} from "@clinebot/core";

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

export function subscribeToAgentEvents(
	sessionManager: SessionManagerSubscriber,
	onAgentEvent: (event: AgentEvent) => void,
	options?: RuntimeHostSubscribeOptions,
): () => void {
	let hasSeenStructuredAgentEvent = false;
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
			// Skip teammate events — they stream concurrently and would interleave
			// with the lead agent's output on shared stdout.
			if (payload?.event && payload.teamRole !== "teammate") {
				onAgentEvent(payload.event);
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
			onAgentEvent(JSON.parse(payload.chunk) as AgentEvent);
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
