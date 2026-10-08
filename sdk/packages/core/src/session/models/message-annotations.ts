import {
	groupSessionMessageIterations,
	hasSessionToolResult,
	type MessageChildSessionLink,
	type MessageWithMetadata,
} from "@cline/shared";

export interface AnnotatePersistedMessagesOptions {
	/** Child sessions started by a tool call, by `tool_use` id. */
	childSessionLinks?: (
		toolCallId: string,
	) => readonly MessageChildSessionLink[] | undefined;
	now?: () => number;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Timestamps for messages written without one: the nearest earlier
 * message's, else the nearest later message's, else now. Keeps `ts`
 * monotonic with its neighbours instead of stamping the write time.
 */
function fillTimestamps(
	messages: readonly MessageWithMetadata[],
	now: () => number,
): number[] {
	const filled: Array<number | undefined> = messages.map((message) =>
		isFiniteNumber(message.ts) ? message.ts : undefined,
	);
	let previous: number | undefined;
	for (let index = 0; index < filled.length; index += 1) {
		const ts = filled[index];
		if (ts === undefined) {
			filled[index] = previous;
		} else {
			previous = ts;
		}
	}
	let next: number | undefined;
	for (let index = filled.length - 1; index >= 0; index -= 1) {
		const ts = filled[index];
		if (ts === undefined) {
			filled[index] = next;
		} else {
			next = ts;
		}
	}
	const fallback = filled.some((ts) => ts === undefined) ? now() : 0;
	return filled.map((ts) => ts ?? fallback);
}

function toolUseIds(message: MessageWithMetadata): string[] {
	if (!Array.isArray(message.content)) {
		return [];
	}
	return message.content.flatMap((block) =>
		block.type === "tool_use" ? [block.id] : [],
	);
}

function mergeChildSessionLinks(
	existing: readonly MessageChildSessionLink[] | undefined,
	added: readonly MessageChildSessionLink[],
): MessageChildSessionLink[] | undefined {
	const merged = new Map<string, MessageChildSessionLink>();
	for (const link of [...(existing ?? []), ...added]) {
		merged.set(`${link.toolCallId}\u0000${link.sessionId}`, link);
	}
	return merged.size > 0 ? [...merged.values()] : undefined;
}

export function isCompactionSummaryMetadata(
	message: MessageWithMetadata,
): boolean {
	return message.metadata?.kind === "compaction_summary";
}

/**
 * Fills the persisted-message fields readers rely on: `ts` on every message,
 * `iteration` on model calls and their tool results, `childSessions` on
 * assistant messages whose tool calls started a subagent or teammate, and
 * `compactionSummary` on compaction summaries. These are top-level fields so
 * the compaction source-prefix hash, which covers metadata, is unaffected.
 */
export function annotatePersistedMessages(
	messages: readonly MessageWithMetadata[],
	options: AnnotatePersistedMessagesOptions = {},
): MessageWithMetadata[] {
	const timestamps = fillTimestamps(messages, options.now ?? Date.now);
	const iterations = new Map<number, number>();
	for (const [position, group] of groupSessionMessageIterations(
		messages,
	).entries()) {
		const assistantIndex = group.assistantIndex;
		if (assistantIndex === undefined) {
			continue;
		}
		iterations.set(assistantIndex, position + 1);
		for (let index = assistantIndex + 1; index < group.end; index += 1) {
			const message = messages[index];
			if (message && hasSessionToolResult(message)) {
				iterations.set(index, position + 1);
			}
		}
	}
	return messages.map((message, index) => {
		const { iteration: _stale, ...rest } = message;
		const next: MessageWithMetadata = { ...rest, ts: timestamps[index] };
		const iteration = iterations.get(index);
		if (iteration !== undefined) {
			next.iteration = iteration;
		}
		if (message.role === "assistant" && options.childSessionLinks) {
			const links = toolUseIds(message).flatMap(
				(id) => options.childSessionLinks?.(id) ?? [],
			);
			const merged = mergeChildSessionLinks(message.childSessions, links);
			if (merged) {
				next.childSessions = merged;
			}
		}
		if (isCompactionSummaryMetadata(message)) {
			next.compactionSummary = true;
		}
		return next;
	});
}

/** Marks compaction summaries in a compaction sidecar's message list. */
export function annotateCompactionMessages(
	messages: readonly MessageWithMetadata[],
): MessageWithMetadata[] {
	return messages.map((message) =>
		isCompactionSummaryMetadata(message) && message.compactionSummary !== true
			? { ...message, compactionSummary: true }
			: message,
	);
}
