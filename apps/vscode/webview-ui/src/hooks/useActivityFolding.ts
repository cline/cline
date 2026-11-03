import { useCallback, useSyncExternalStore } from "react"

/**
 * Webview-local preference: fold the agent's activities (tool calls, command executions, diffs,
 * thinking) into collapsible groups instead of rendering every row at full height.
 *
 * It lives in `localStorage` (like other pure-view preferences) so it applies to every task
 * immediately and survives reloads, without a round-trip to the extension host.
 */
const STORAGE_KEY = "cline.chat.activityFolding.enabled"
const CHANGE_EVENT = "cline:chat-activity-folding-change"

/** Session value once the user (or a storage read) has decided; `undefined` = not read yet. */
let memoryValue: boolean | undefined

function read(): boolean {
	if (memoryValue !== undefined) {
		return memoryValue
	}
	try {
		memoryValue = window.localStorage.getItem(STORAGE_KEY) !== "false"
	} catch {
		// localStorage may be unavailable (restricted webview, tests) - keep the default.
		memoryValue = true
	}
	return memoryValue
}

function subscribe(onChange: () => void): () => void {
	window.addEventListener(CHANGE_EVENT, onChange)
	return () => window.removeEventListener(CHANGE_EVENT, onChange)
}

/** Set the preference and notify every mounted chat view. */
export function setActivityFoldingEnabled(enabled: boolean): void {
	memoryValue = enabled
	try {
		window.localStorage.setItem(STORAGE_KEY, String(enabled))
	} catch {
		// Storage unavailable: the in-memory value still applies for this session.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function isActivityFoldingEnabled(): boolean {
	return read()
}

export function useActivityFoldingEnabled(): [boolean, (enabled: boolean) => void] {
	const enabled = useSyncExternalStore(subscribe, read, () => true)
	const setEnabled = useCallback((next: boolean) => setActivityFoldingEnabled(next), [])
	return [enabled, setEnabled]
}
