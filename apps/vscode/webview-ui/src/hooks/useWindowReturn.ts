import { useEffect, useRef } from "react"

/**
 * Runs `onReturn` when the user comes back to this webview after being away,
 * e.g. from a browser tab the extension opened. VS Code reports a return as
 * window `focus` (the user clicked into the panel), as `visibilitychange`
 * (the panel's tab or window was shown), or as both in close succession;
 * the two are coalesced so one return runs the callback once.
 *
 * The latest `onReturn` is used without re-subscribing, so callers may pass
 * an inline function.
 */
export function useWindowReturn(onReturn: (() => void) | undefined): void {
	const callback = useRef(onReturn)
	callback.current = onReturn
	const enabled = onReturn !== undefined

	useEffect(() => {
		if (!enabled) {
			return
		}
		let lastReturnAt = 0
		const returned = () => {
			if (document.visibilityState === "hidden") {
				return
			}
			const now = Date.now()
			if (now - lastReturnAt < RETURN_COALESCE_MS) {
				return
			}
			lastReturnAt = now
			callback.current?.()
		}
		window.addEventListener("focus", returned)
		document.addEventListener("visibilitychange", returned)
		return () => {
			window.removeEventListener("focus", returned)
			document.removeEventListener("visibilitychange", returned)
		}
	}, [enabled])
}

/** `focus` and `visibilitychange` for one return arrive within a few milliseconds of each other. */
const RETURN_COALESCE_MS = 500
