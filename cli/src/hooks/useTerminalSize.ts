import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Reactive terminal size hook with resize recovery.
 *
 * WHY THIS EXISTS:
 * Ink tracks how many lines it rendered last frame (`previousLineCount` in log-update.js,
 * `lastOutputHeight` in ink.js). On re-render it erases that many lines then writes new
 * output. When the terminal resizes, text wrapping changes so the actual number of lines
 * on screen no longer matches what Ink thinks it rendered. This causes cascading visual
 * artifacts: old content doesn't get fully erased, and new content renders on top of it.
 *
 * We tried several approaches that didn't work:
 * - Writing \x1b[2J\x1b[H before state update: Ink overwrites the clear with its own
 *   stale-count erasure immediately after.
 * - Calling Ink's clear() via prependListener on resize: clear() itself uses the stale
 *   previousLineCount to erase, so it erases the wrong number of lines too.
 * - Patching Ink's resized() to reset lastOutputHeight: The dynamic region renders
 *   cleanly but Static content (already printed to scrollback) is gone and Ink won't
 *   re-render it since it tracks which Static items have been rendered by key.
 *
 * WHAT WORKS (borrowed from Gemini CLI's approach):
 * 1. Debounce resize events (300ms) so we wait until the user stops dragging
 * 2. Clear the entire terminal including scrollback (\x1b[2J\x1b[3J\x1b[H)
 * 3. Increment a `resizeKey` used as a React key on the content tree, forcing React
 *    to unmount and remount everything from scratch. This resets Ink's internal tracking
 *    AND re-renders Static content since the components are brand new instances.
 *
 * Gemini CLI does the same thing in AppContainer.tsx: debounce 300ms, then
 * stdout.write(ansiEscapes.clearTerminal) + setHistoryRemountKey(prev => prev + 1).
 *
 * USAGE:
 * - `columns`/`rows`: Current terminal dimensions, updated live during resize
 * - `resizeKey`: Increments after resize settles. Use as a React `key` on the root
 *   content wrapper to force full remount.
 */
export function useTerminalSize() {
	const [size, setSize] = useState({
		columns: process.stdout.columns || 80,
		rows: process.stdout.rows || 24,
	})
	const [resizeKey, setResizeKey] = useState(0)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const refreshAfterResize = useCallback(() => {
		// Clear terminal + scrollback to wipe stale content from old width
		// \x1b[2J clears visible screen, \x1b[3J clears scrollback, \x1b[H moves cursor home
		// Use process.stdout directly with callback to ensure clear completes before React re-renders.
		// Without the callback, the state update can trigger a re-render that interleaves with
		// the buffered escape sequences, causing visual artifacts in the scrollback.
		process.stdout.write("\x1b[2J\x1b[3J\x1b[H", () => {
			// Increment key to force React remount only after clear is flushed
			setResizeKey((prev) => prev + 1)
		})
	}, [])

	useEffect(() => {
		function updateSize() {
			setSize({
				columns: process.stdout.columns || 80,
				rows: process.stdout.rows || 24,
			})

			// Debounce: wait 300ms after last resize event to do full recovery
			if (debounceRef.current) {
				clearTimeout(debounceRef.current)
			}
			debounceRef.current = setTimeout(() => {
				refreshAfterResize()
				debounceRef.current = null
			}, 300)
		}
		process.stdout.on("resize", updateSize)
		return () => {
			process.stdout.off("resize", updateSize)
			if (debounceRef.current) {
				clearTimeout(debounceRef.current)
			}
		}
	}, [refreshAfterResize])

	return { ...size, resizeKey }
}
