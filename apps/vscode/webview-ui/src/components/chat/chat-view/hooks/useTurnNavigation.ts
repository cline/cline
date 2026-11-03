import { type RefObject, useCallback, useEffect } from "react"
import type { VirtuosoHandle } from "react-virtuoso"
import { nearestByRatio, resolveChatScroller, type TimelineMarker } from "../utils/turnTimeline"

/** Frames the landing correction waits for the virtualiser to build the target row. */
const LANDING_FRAMES = 10

/** Breathing room between the pinned prompt and the row a jump lands on. */
const LANDING_GAP_PX = 8

/** How much the sticky prompt covers at the top of the list — 0 while nothing is pinned. */
function stickyCover(scroller: HTMLElement | null): number {
	if (!scroller) {
		return 0
	}
	const sticky = scroller.parentElement?.querySelector<HTMLElement>("[data-sticky-header]")
	const height = sticky?.getBoundingClientRect().height ?? 0
	return height > 1 ? Math.round(height) + LANDING_GAP_PX : 0
}

/**
 * Moves the scroller until the row sits exactly `below` px under its top edge.
 *
 * `scrollToIndex` positions an *estimated* offset, and a folded run of activity is far shorter than
 * the estimate, so a jump can land tens of rows away — the target arrived hidden under the pinned
 * prompt or off screen altogether. The first jump renders the neighbourhood; from there the row's
 * own rect decides, one frame at a time, until it is where the reader meant to go.
 */
export function landRowBelow(scroller: HTMLElement, ts: number, below: number, framesLeft = LANDING_FRAMES): void {
	if (framesLeft <= 0) {
		return
	}
	requestAnimationFrame(() => {
		const row = scroller.querySelector<HTMLElement>(`[data-message-ts="${ts}"]`)
		if (!row) {
			// Not rendered yet: the jump above has to let the virtualiser build it first.
			landRowBelow(scroller, ts, below, framesLeft - 1)
			return
		}
		const delta = row.getBoundingClientRect().top - (scroller.getBoundingClientRect().top + below)
		if (Math.abs(delta) <= 1) {
			return
		}
		scroller.scrollTop = scroller.scrollTop + delta
		landRowBelow(scroller, ts, below, framesLeft - 1)
	})
}

interface UseTurnNavigationOptions {
	/** Prompts and final answers, in reading order. */
	markers: TimelineMarker[]
	/** Rail fraction per marker; the jump starts from the one nearest this position. */
	positions: number[]
	enabled: boolean
	virtuosoRef: RefObject<VirtuosoHandle | null>
	scrollContainerRef: RefObject<HTMLElement | null>
	/**
	 * Announces the jump to the reading-position lock. `scrollToIndex` is instant, so the list lands
	 * somewhere new in one frame; without this the lock can mistake that for content moving under
	 * the reader and pull the old distance back.
	 */
	onJump?: () => void
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
	const { markers, positions, enabled, virtuosoRef, scrollContainerRef, onJump } = options

	const jumpTo = useCallback(
		(marker: TimelineMarker) => {
			onJump?.()
			const scroller = resolveChatScroller(scrollContainerRef.current)
			const below = stickyCover(scroller)
			// Instant on purpose: virtuoso has not measured the rows in between, so a smooth scroll
			// animates toward an estimate and then crawls while it corrects itself. The estimate is
			// only a starting point — the correction below lands on the row itself.
			virtuosoRef.current?.scrollToIndex({ index: marker.listIndex, align: "start", behavior: "auto", offset: -below })
			if (scroller) {
				landRowBelow(scroller, marker.ts, below)
			}
		},
		[onJump, scrollContainerRef, virtuosoRef],
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
