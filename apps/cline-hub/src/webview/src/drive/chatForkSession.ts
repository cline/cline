/** True when a session summary / metadata marks an invisible ChatFork worker. */
export function isChatForkSession(sessionOrMetadata: unknown): boolean {
	if (!sessionOrMetadata || typeof sessionOrMetadata !== "object") {
		return false;
	}
	const record = sessionOrMetadata as Record<string, unknown>;
	return record.chatFork === true || record.isSubagent === true;
}
