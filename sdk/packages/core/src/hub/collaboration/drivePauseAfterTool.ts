/**
 * Process-wide pause-after-tool flags for Drive raise-hand (DRV-INTERRUPT).
 *
 * Linked sessions pause iff any current room participant has a raised hand
 * on the post-mutation snapshot. SessionRuntime consults these via
 * `AgentRuntimeHooks.shouldPauseAfterTool`.
 */

const pauseBySessionId = new Map<string, boolean>();

export function setDrivePauseAfterTool(
	sessionId: string,
	pause: boolean,
): void {
	if (pause) {
		pauseBySessionId.set(sessionId, true);
	} else {
		pauseBySessionId.delete(sessionId);
	}
}

export function shouldDrivePauseAfterTool(sessionId: string): boolean {
	return pauseBySessionId.get(sessionId) === true;
}

export function clearDrivePauseAfterTool(sessionId: string): void {
	pauseBySessionId.delete(sessionId);
}

/** Clear flags for every session currently linked to a room. */
export function clearDrivePauseAfterToolForSessions(
	sessionIds: Iterable<string>,
): void {
	for (const sessionId of sessionIds) {
		pauseBySessionId.delete(sessionId);
	}
}

type RaisedHandSnapshot = {
	raisedHandByParticipantId: Record<string, boolean>;
	participants: ReadonlyArray<{ id: string }>;
};

/**
 * Sync pause-after-tool for linked sessions from a room snapshot.
 * True iff any current participant still has a raised hand.
 */
export function syncDrivePauseAfterToolForRoom(
	snapshot: RaisedHandSnapshot,
	sessionIds: Iterable<string>,
): void {
	const anyRaised = snapshot.participants.some(
		(p) => snapshot.raisedHandByParticipantId[p.id] === true,
	);
	for (const sessionId of sessionIds) {
		setDrivePauseAfterTool(sessionId, anyRaised);
	}
}

export function resetDrivePauseAfterToolForTests(): void {
	pauseBySessionId.clear();
}
