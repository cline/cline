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
	if (result.messagesBefore === result.messagesAfter) {
		return `Compacted context; message count stayed at ${result.messagesAfter}.`;
	}
	return `Compacted ${result.messagesBefore} messages to ${result.messagesAfter}.`;
}
