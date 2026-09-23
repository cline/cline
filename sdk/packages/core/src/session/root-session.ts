/** Any positive child marker wins, including markers from older Hub metadata. */
export function isRootSessionRecord(record: {
	isSubagent?: unknown;
	parentSessionId?: unknown;
	metadata?: unknown;
}): boolean {
	const metadata =
		record.metadata && typeof record.metadata === "object"
			? (record.metadata as Record<string, unknown>)
			: undefined;
	return (
		record.isSubagent !== true &&
		metadata?.isSubagent !== true &&
		!hasParent(record.parentSessionId) &&
		!hasParent(metadata?.parentSessionId)
	);
}

function hasParent(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}
