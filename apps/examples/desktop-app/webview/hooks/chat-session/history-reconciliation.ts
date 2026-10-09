import type { ChatMessage } from "@/lib/chat-schema";

function latestRunCount(messages: ChatMessage[]): number {
	let count = 0;
	for (const message of messages) {
		const stored = message.meta?.runCount ?? message.meta?.checkpoint?.runCount;
		if (stored !== undefined) {
			count = Math.max(count, stored);
		} else if (message.role === "user") {
			count += message.meta?.userRunSpan ?? 1;
		}
	}
	return count;
}

/** A prior run's persisted failure is not evidence that this run has flushed. */
export function canReplaceFailedTurn(
	current: ChatMessage[],
	history: ChatMessage[],
): boolean {
	const liveError = current.at(-1);
	if (liveError?.role !== "error") return true;
	const savedError = history.at(-1);
	if (savedError?.role !== "error") return false;
	if (latestRunCount(history) < latestRunCount(current)) return false;
	// An earlier failure can share the same text and user-run count (e.g. a
	// continuation without a new prompt). Its stable ID still identifies it.
	return !current.slice(0, -1).some((message) => message.id === savedError.id);
}

/** Chat lines the webview shows but the saved transcript never contains. */
export const PLUGIN_ISSUE_MESSAGE_KIND = "plugin_issue";

/**
 * Carries the live plugin-warning lines into canonical history, each at its
 * original position by time. Plugin warnings come from the session start
 * reply and stream notices, not from the persisted transcript, so replacing
 * the live messages with saved history would otherwise drop them.
 */
export function withLivePluginIssues(
	current: ChatMessage[],
	history: ChatMessage[],
): ChatMessage[] {
	const savedIds = new Set(history.map((message) => message.id));
	const liveOnly = current.filter(
		(message) =>
			message.meta?.messageKind === PLUGIN_ISSUE_MESSAGE_KIND &&
			!savedIds.has(message.id),
	);
	if (liveOnly.length === 0) return history;
	const merged = [...history];
	for (const message of liveOnly) {
		const index = merged.findIndex(
			(candidate) => candidate.createdAt > message.createdAt,
		);
		if (index === -1) merged.push(message);
		else merged.splice(index, 0, message);
	}
	return merged;
}
