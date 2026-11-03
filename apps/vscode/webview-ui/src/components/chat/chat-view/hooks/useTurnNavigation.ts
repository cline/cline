import { type RefObject, useCallback, useEffect } from "react"
import type { VirtuosoHandle } from "react-virtuoso"
import { nearestByRatio, type TimelineMarker } from "../utils/turnTimeline"

interface UseTurnNavigationOptions {
	/** Prompts and final answers, in reading order. */
	markers: TimelineMarker[]
	/** Rail fraction per marker; the jump starts from the one nearest this position. */
	positions: number[]
	enabled: boolean
	virtuosoRef: RefObject<VirtuosoHandle | null>
	scrollContainerRef: RefObject<HTMLElement | null>
}

/** Scroll position of the list as a 0..1 fraction. */
function readScrollRatio(element: HTMLElement | null): number {
	if (!element) {
		return 0
	}
	const max = element.scrollHeight - element.clientHeight
	return max <= 0 ? 0 : element.scrollTop / max
}

/**
 * Ctrl+PageUp / PageDown (Cmd on macOS) between prompts and final answers.
 *
 * Stepping starts from wherever the viewport currently is rather than from a remembered cursor,
 * so scrolling away by hand and then pressing PageDown continues from the visible position.
 */
export function useTurnNavigation(options: UseTurnNavigationOptions): {
	jumpTo: (marker: TimelineMarker) => void
	step: (direction: 1 | -1) => void
} {
	const { markers, positions, enabled, virtuosoRef, scrollContainerRef } = options

	const jumpTo = useCallback(
		(marker: TimelineMarker) => {
			// Instant on purpose: virtuoso has not measured the rows in between, so a smooth scroll
			// animates toward an estimate and then crawls while it corrects itself.
			virtuosoRef.current?.scrollToIndex({ index: marker.listIndex, align: "start", behavior: "auto" })
		},
		[virtuosoRef],
	)

	const step = useCallback(
		(direction: 1 | -1) => {
			if (markers.length === 0) {
				return
			}
			const current = nearestByRatio(positions, readScrollRatio(scrollContainerRef.current))
			// Move strictly past the nearest marker in the requested direction.
			const next = direction === 1 ? markers[current + 1] : markers[current - 1]
			if (next) {
				jumpTo(next)
			}
		},
		[jumpTo, markers, positions, scrollContainerRef],
	)

	useEffect(() => {
		if (!enabled) {
			return
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey)) {
				return
			}
			if (event.key === "PageDown") {
				event.preventDefault()
				step(1)
			} else if (event.key === "PageUp") {
				event.preventDefault()
				step(-1)
			}
		}
		// Capture phase: the chat input is a textarea and would otherwise swallow the key first.
		window.addEventListener("keydown", onKeyDown, true)
		return () => window.removeEventListener("keydown", onKeyDown, true)
	}, [enabled, step])

	return { jumpTo, step }
}
