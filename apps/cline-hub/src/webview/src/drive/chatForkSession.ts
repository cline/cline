import type { ChatForkRecord, ShowBacklogItem } from "@cline/shared";

/** True when a session summary / metadata marks an invisible ChatFork worker. */
export function isChatForkSession(sessionOrMetadata: unknown): boolean {
	if (!sessionOrMetadata || typeof sessionOrMetadata !== "object") {
		return false;
	}
	const record = sessionOrMetadata as Record<string, unknown>;
	return record.chatFork === true || record.isSubagent === true;
}

/** Show ids from promote packet plus backlog rows linked to the Do item. */
export function showIdsForFork(
	fork: ChatForkRecord,
	showBacklog: readonly ShowBacklogItem[] = [],
): string[] {
	const fromPromote = fork.promote?.showItemIds ?? [];
	const fromBacklog = showBacklog
		.filter((item) => item.linkedDoItemId === fork.seed.doItemId)
		.map((item) => item.id);
	return [...new Set([...fromPromote, ...fromBacklog])];
}
