/** Sessions, and revisions per session, the webview remembers as exposed; the view model keeps 32 revisions too. */
const EXPOSED_SESSIONS_KEPT = 32;
const EXPOSED_REVISIONS_KEPT = 32;

/**
 * Revisions each session's tray already reported exposed, outliving the pane:
 * ChatThreadPane is keyed per thread, so leaving a session and coming back
 * remounts the hook, and the view model's own set would start empty.
 */
function createExposedSuggestionMemory() {
	const bySession = new Map<string, readonly string[]>();
	const keyOf = (environmentId: string, sessionId: string) =>
		`${environmentId}\n${sessionId}`;
	return {
		revisions(environmentId: string, sessionId: string): readonly string[] {
			return bySession.get(keyOf(environmentId, sessionId)) ?? [];
		},
		remember(environmentId: string, sessionId: string, revision: string) {
			const key = keyOf(environmentId, sessionId);
			const kept = (bySession.get(key) ?? []).filter(
				(remembered) => remembered !== revision,
			);
			bySession.delete(key);
			bySession.set(key, [...kept, revision].slice(-EXPOSED_REVISIONS_KEPT));
			for (const oldest of bySession.keys()) {
				if (bySession.size <= EXPOSED_SESSIONS_KEPT) break;
				bySession.delete(oldest);
			}
		},
		clear() {
			bySession.clear();
		},
	};
}

export const exposedSuggestionMemory = createExposedSuggestionMemory();
