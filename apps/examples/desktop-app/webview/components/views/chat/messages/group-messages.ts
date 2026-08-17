import type { AgentMessageRole } from "@cline/ui/components/agent-chat";
import type { ChatMessage } from "@/lib/chat-schema";

export type ChatRenderItem =
	| {
			type: "message";
			agentRole: AgentMessageRole;
			message: ChatMessage;
			reasoningMessages: ChatMessage[];
	  }
	| { type: "tools"; messages: ChatMessage[] }
	| {
			type: "work";
			/** Stable per-run key: the id of the first collapsed message. */
			id: string;
			items: ChatRenderItem[];
			durationMilliseconds?: number;
			toolCallCount: number;
	  };

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

export type CollapseWorkOptions = {
	/**
	 * Whether the run after the last user message may collapse too. Pass true
	 * only once the session stopped running — the live run must keep rendering
	 * its rows as they stream in.
	 */
	collapseTrailingRun: boolean;
};

/**
 * Working rows collapse, deliverables stay: tool groups plus assistant
 * narration/thinking that carries no images or media. An assistant message
 * with attachments is a deliverable and acts as a span boundary instead.
 */
function isCollapsibleWorkItem(item: ChatRenderItem): boolean {
	if (item.type === "tools") return true;
	return (
		item.type === "message" &&
		item.message.role === "assistant" &&
		!item.message.images?.length &&
		!item.message.media?.length
	);
}

function firstTimestamp(item: ChatRenderItem): number | undefined {
	if (item.type === "tools") return item.messages[0]?.createdAt;
	if (item.type === "message") {
		return (item.reasoningMessages[0] ?? item.message).createdAt;
	}
	return undefined;
}

function lastTimestamp(item: ChatRenderItem): number | undefined {
	if (item.type === "tools") return item.messages.at(-1)?.createdAt;
	if (item.type === "message") return item.message.createdAt;
	return undefined;
}

function firstMessageId(item: ChatRenderItem): string | undefined {
	if (item.type === "tools") return item.messages[0]?.id;
	if (item.type === "message") {
		return (item.reasoningMessages[0] ?? item.message).id;
	}
	return item.id;
}

/**
 * Folds each finished run's working rows (tool calls, thinking traces,
 * intermediate narration) into a single expandable `work` item, keeping the
 * run's final answer — the assistant text the run ended on — visible after it.
 * Runs still streaming, and runs without any tool calls, pass through as-is.
 */
export function collapseCompletedWork(
	items: ChatRenderItem[],
	{ collapseTrailingRun }: CollapseWorkOptions,
): ChatRenderItem[] {
	let lastUserIndex = -1;
	for (let index = items.length - 1; index >= 0; index--) {
		const item = items[index];
		if (item.type === "message" && item.message.role === "user") {
			lastUserIndex = index;
			break;
		}
	}

	const out: ChatRenderItem[] = [];
	let span: ChatRenderItem[] = [];
	// When the span directly follows a user message, "Worked for" counts from
	// that message so the label reflects the whole run, not just row deltas.
	let runStartTimestamp: number | undefined;

	const flushSpan = (nextIndex: number) => {
		if (span.length === 0) return;
		// "Done" means assistant text not followed by more tool calls: that
		// message is the run's answer and stays visible below the summary.
		const last = span.at(-1);
		const answer =
			last?.type === "message" && last.message.content.trim()
				? last
				: undefined;
		// A span is settled once a later user message exists. The trailing span
		// settles only when the session stopped running AND the run actually
		// ended on an answer — a cancelled or failed tail keeps its rows
		// visible so the user can see where the run stopped.
		const complete =
			nextIndex <= lastUserIndex ||
			(collapseTrailingRun && answer !== undefined);
		const collapsed = complete && answer ? span.slice(0, -1) : span;
		const toolCallCount = collapsed.reduce(
			(count, item) =>
				item.type === "tools" ? count + item.messages.length : count,
			0,
		);
		const firstCollapsed = collapsed[0];
		if (!complete || toolCallCount === 0 || firstCollapsed === undefined) {
			out.push(...span);
		} else {
			const startTimestamp =
				runStartTimestamp ?? firstTimestamp(firstCollapsed);
			const lastCollapsed = collapsed[collapsed.length - 1];
			const endTimestamp = answer
				? firstTimestamp(answer)
				: lastTimestamp(lastCollapsed);
			const durationMilliseconds =
				startTimestamp !== undefined &&
				endTimestamp !== undefined &&
				Number.isFinite(startTimestamp) &&
				Number.isFinite(endTimestamp) &&
				endTimestamp >= startTimestamp
					? endTimestamp - startTimestamp
					: undefined;
			out.push({
				type: "work",
				id: firstMessageId(firstCollapsed) ?? "work",
				items: collapsed,
				durationMilliseconds,
				toolCallCount,
			});
			if (answer) {
				out.push(answer);
			}
		}
		span = [];
	};

	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		if (isCollapsibleWorkItem(item)) {
			span.push(item);
			continue;
		}
		flushSpan(index);
		out.push(item);
		runStartTimestamp =
			item.type === "message" && item.message.role === "user"
				? item.message.createdAt
				: undefined;
	}
	flushSpan(items.length);
	return out;
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
