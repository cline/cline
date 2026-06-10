import type { InteractiveCompactionResult } from "../types";

function formatMessageCount(count: number): string {
	return `${count} ${count === 1 ? "message" : "messages"}`;
}

export function formatCompactionStatus(
	result: InteractiveCompactionResult,
): string {
	if (result.messagesBefore === 0) {
		return "No messages to compact.";
	}
	if (!result.compacted) {
		return "No compaction needed.";
	}
	if (typeof result.workingContextMessagesAfter === "number") {
		return `Compacted working context to ${formatMessageCount(result.workingContextMessagesAfter)}; canonical history remains ${formatMessageCount(result.messagesAfter)}.`;
	}
	if (result.messagesBefore === result.messagesAfter) {
		return `Compacted context; message count stayed at ${formatMessageCount(result.messagesAfter)}.`;
	}
	return `Compacted ${formatMessageCount(result.messagesBefore)} to ${formatMessageCount(result.messagesAfter)}.`;
}
