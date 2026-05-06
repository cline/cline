import type { InteractiveCompactionResult } from "../types";

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
		return `Compacted working context to ${result.workingContextMessagesAfter} messages; canonical history remains ${result.messagesAfter} messages.`;
	}
	if (result.messagesBefore === result.messagesAfter) {
		return `Compacted context; message count stayed at ${result.messagesAfter}.`;
	}
	return `Compacted ${result.messagesBefore} messages to ${result.messagesAfter}.`;
}
