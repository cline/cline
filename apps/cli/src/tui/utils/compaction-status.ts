import type { ChatEntry, InteractiveCompactionResult } from "../types";

export type CompactionDividerEntry = Extract<ChatEntry, { kind: "compaction" }>;

function formatMessageCount(count: number): string {
	return `${count} ${count === 1 ? "message" : "messages"}`;
}

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/**
 * Extracts a compaction divider entry from a status notice's metadata.
 * "started" notices produce a streaming (in-progress) divider; "completed"
 * notices produce the final divider with counters. Returns undefined for
 * non-compaction notices.
 */
export function parseCompactionNoticeMetadata(
	metadata: Record<string, unknown> | undefined,
): Omit<CompactionDividerEntry, "kind"> | undefined {
	if (
		!metadata ||
		(metadata.phase !== "started" && metadata.phase !== "completed")
	) {
		return undefined;
	}
	const kind = metadata.kind ?? metadata.reason;
	if (kind !== "auto_compaction" && kind !== "manual_compaction") {
		return undefined;
	}
	const compactionMode = kind === "manual_compaction" ? "manual" : "auto";
	if (metadata.phase === "started") {
		return { compactionMode, status: "started" };
	}
	return {
		compactionMode,
		status: "completed",
		tokensBefore: asFiniteNumber(metadata.tokensBefore),
		tokensAfter: asFiniteNumber(metadata.tokensAfter),
		messagesBefore: asFiniteNumber(metadata.messagesBefore),
		messagesAfter: asFiniteNumber(metadata.messagesAfter),
	};
}

export function formatTokenCount(count: number): string {
	if (count < 1_000) {
		return `${count}`;
	}
	if (count < 1_000_000) {
		return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
	}
	return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatCompactionDividerLabel(
	entry: CompactionDividerEntry,
): string {
	if (entry.status === "started") {
		return entry.compactionMode === "manual"
			? "Compacting messages"
			: "Auto compacting messages";
	}
	if (entry.status === "failed") {
		return "Compaction failed";
	}
	if (entry.status === "cancelled") {
		return "Compaction cancelled";
	}
	const parts: string[] = [
		entry.compactionMode === "manual"
			? "Context compacted (manual)"
			: entry.compactionMode === "inherited"
				? "Compacted working context carried over"
				: "Context compacted",
	];
	if (
		typeof entry.tokensBefore === "number" &&
		typeof entry.tokensAfter === "number"
	) {
		parts.push(
			`${formatTokenCount(entry.tokensBefore)} → ${formatTokenCount(entry.tokensAfter)} tokens`,
		);
	}
	if (
		typeof entry.messagesBefore === "number" &&
		typeof entry.messagesAfter === "number"
	) {
		parts.push(`${entry.messagesBefore} → ${entry.messagesAfter} messages`);
	}
	return parts.join(" · ");
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
		return `Compacted working context to ${formatMessageCount(result.workingContextMessagesAfter)}; saved history remains ${formatMessageCount(result.messagesAfter)}.`;
	}
	if (result.messagesBefore === result.messagesAfter) {
		return `Compacted context; message count stayed at ${formatMessageCount(result.messagesAfter)}.`;
	}
	return `Compacted ${formatMessageCount(result.messagesBefore)} to ${formatMessageCount(result.messagesAfter)}.`;
}
