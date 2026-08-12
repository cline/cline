import type { AgentMessageRole } from "@cline/ui/components/agent-chat";
import type { ChatMessage } from "@/lib/chat-schema";

export type ChatRenderItem =
	| {
			type: "message";
			agentRole: AgentMessageRole;
			message: ChatMessage;
			reasoningMessages: ChatMessage[];
	  }
	| { type: "tools"; messages: ChatMessage[] };

export function hasMessageReasoning(message: ChatMessage): boolean {
	return Boolean(message.reasoning?.trim() || message.reasoningRedacted);
}

export function isReasoningOnlyAssistantMessage(message: ChatMessage): boolean {
	return (
		message.role === "assistant" &&
		hasMessageReasoning(message) &&
		!message.content.trim() &&
		!message.images?.length
	);
}

export function buildPreviousTimestampMap(
	messages: ChatMessage[],
): Map<ChatMessage, number | undefined> {
	const previousTimestampByMessage = new Map<ChatMessage, number | undefined>();
	let previousTimestamp: number | undefined;

	for (const message of messages) {
		previousTimestampByMessage.set(message, previousTimestamp);
		if (Number.isFinite(message.createdAt)) {
			previousTimestamp = message.createdAt;
		}
	}

	return previousTimestampByMessage;
}

export function buildUserRunCountMap(
	messages: ChatMessage[],
): Map<ChatMessage, number> {
	const runCountByMessage = new Map<ChatMessage, number>();
	let lastRunCount = 0;

	for (const message of messages) {
		const userRunSpan =
			message.meta?.userRunSpan ?? (message.role === "user" ? 1 : 0);
		const storedRunCount =
			message.meta?.runCount ?? message.meta?.checkpoint?.runCount;
		if (storedRunCount !== undefined) {
			lastRunCount = Math.max(lastRunCount, storedRunCount);
			if (message.role === "user" && userRunSpan === 1) {
				runCountByMessage.set(message, storedRunCount);
			}
			continue;
		}
		lastRunCount += userRunSpan;
		if (message.role === "user" && userRunSpan === 1) {
			runCountByMessage.set(message, lastRunCount);
		}
	}

	return runCountByMessage;
}

export function getThoughtDurationMilliseconds(
	previousTimestamp: number | undefined,
	thinkingTimestamp: number,
): number | undefined {
	if (
		previousTimestamp === undefined ||
		!Number.isFinite(previousTimestamp) ||
		!Number.isFinite(thinkingTimestamp) ||
		thinkingTimestamp < previousTimestamp
	) {
		return undefined;
	}

	return thinkingTimestamp - previousTimestamp;
}

export function formatThoughtLabel(durationMilliseconds?: number): string {
	if (durationMilliseconds === undefined) {
		return "Thinking";
	}

	const seconds =
		durationMilliseconds === 0
			? 0
			: Math.max(1, Math.round(durationMilliseconds / 1000));

	return `Thought for ${seconds}s`;
}

export function groupChatMessages(messages: ChatMessage[]): ChatRenderItem[] {
	const items: ChatRenderItem[] = [];
	let pendingReasoningMessages: ChatMessage[] = [];

	const pushMessage = (
		message: ChatMessage,
		agentRole: AgentMessageRole,
		reasoningMessages = hasMessageReasoning(message) ? [message] : [],
	) => {
		items.push({
			type: "message",
			agentRole,
			message,
			reasoningMessages,
		});
	};

	const flushPendingReasoning = () => {
		const message = pendingReasoningMessages.at(-1);
		if (!message) {
			return;
		}
		pushMessage(message, "assistant", pendingReasoningMessages);
		pendingReasoningMessages = [];
	};

	for (const message of messages) {
		if (isReasoningOnlyAssistantMessage(message)) {
			pendingReasoningMessages.push(message);
			continue;
		}

		if (message.role === "assistant" && pendingReasoningMessages.length > 0) {
			const reasoningMessages = hasMessageReasoning(message)
				? [...pendingReasoningMessages, message]
				: pendingReasoningMessages;
			pushMessage(message, "assistant", reasoningMessages);
			pendingReasoningMessages = [];
			continue;
		}

		flushPendingReasoning();
		const previous = items.at(-1);
		if (message.role === "tool") {
			if (previous?.type === "tools") {
				previous.messages.push(message);
			} else {
				items.push({ type: "tools", messages: [message] });
			}
			continue;
		}
		pushMessage(message, message.role);
	}
	flushPendingReasoning();
	return items;
}
