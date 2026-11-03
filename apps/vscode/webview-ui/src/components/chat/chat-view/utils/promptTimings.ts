/**
 * Typing duration of a prompt: first real keystroke until send.
 *
 * Nothing in the transcript can reconstruct this — a message row is stamped when it is sent, so
 * the moment the user started typing only exists in the webview while they type. The fork keeps
 * it in `localStorage` rather than on `ClineMessage`: that message is a protobuf projection of
 * the SDK transcript (`role`/`content`), so a new field there would have to survive the
 * seq/epoch merge *and* still be dropped on reload. `localStorage` is the only place this
 * survives without touching upstream's storage or proto.
 *
 * Consequence worth knowing: timings are per device and per VS Code profile, not portable with
 * the session folder.
 */

const STORAGE_KEY = "ccline.promptTimings.v1"
/** Roughly a few weeks of prompts; oldest entries are evicted first. */
const MAX_ENTRIES = 800

type TimingMap = Record<string, number>

/** `task.ts` identifies a session well enough for the webview and needs no extra plumbing. */
export function promptTimingKey(sessionKey: number, promptTs: number): string {
	return `${sessionKey}:${promptTs}`
}

function readStore(): TimingMap | undefined {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) {
			return undefined
		}
		const parsed: unknown = JSON.parse(raw)
		return parsed && typeof parsed === "object" ? (parsed as TimingMap) : undefined
	} catch {
		// Disabled storage, private mode, or a corrupted value: behave as if nothing was recorded.
		return undefined
	}
}

/** Recorded typing duration in ms, or `undefined` when never captured. */
export function getPromptTypingMs(sessionKey: number, promptTs: number): number | undefined {
	return readStore()?.[promptTimingKey(sessionKey, promptTs)]
}

/**
 * Store one measurement. Silently gives up when storage is unavailable or full — the timeline
 * simply omits the typing duration instead of breaking the send.
 */
export function recordPromptTypingMs(sessionKey: number, promptTs: number, typingMs: number): void {
	if (!Number.isFinite(typingMs) || typingMs <= 0) {
		return
	}
	try {
		const store = readStore() ?? {}
		const key = promptTimingKey(sessionKey, promptTs)
		// Re-insert so insertion order tracks recency for eviction.
		delete store[key]
		store[key] = Math.round(typingMs)

		const keys = Object.keys(store)
		if (keys.length > MAX_ENTRIES) {
			for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) {
				delete store[stale]
			}
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
	} catch {
		// Quota or access error: nothing to recover from.
	}
}
