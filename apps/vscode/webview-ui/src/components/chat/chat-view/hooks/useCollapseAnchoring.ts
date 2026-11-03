import { type RefObject, useLayoutEffect, useRef } from "react"

/** How close to the bottom counts as "the list is pinned", where anchoring is pointless. */
const BOTTOM_TOLERANCE_PX = 8

/**
 * Keeps the reading position stable when a fold above it collapses.
 *
 * While the agent works, folds open and close on their own. If the user has scrolled up to read
 * something and a fold *above* that position collapses, the rows they are looking at slide up by
 * the freed height — the history appears to jump backwards. The browser cannot anchor this for us
 * (the list sets `overflow-anchor: none`, which upstream needs for its own expand/collapse
 * behaviour), so the freed space is handed back by moving `scrollTop` up by the same amount: the
 * gap opens where the content used to be, and everything below keeps its place.
 *
 * Only a fold that sits entirely above the viewport qualifies. One inside or below it either
 * collapses in plain sight (intended) or cannot move what is on screen.
 */
export function useCollapseAnchoring(ref: RefObject<HTMLElement | null>, expanded: boolean): void {
	// Geometry from the previous commit, captured before this one changed the layout.
	const previous = useRef<{ top: number; height: number } | undefined>(undefined)

	useLayoutEffect(() => {
		const element = ref.current
		const scroller = element?.closest<HTMLElement>(".chat-scrollbar")
		if (!element || !scroller) {
			return
		}
		const height = element.offsetHeight
		// Position within the scrollable content, so scrolling itself is not mistaken for a change.
		const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
		const before = previous.current
		previous.current = { top, height }
		if (!before) {
			return
		}

		const freed = before.height - height
		if (freed <= 0) {
			return
		}
		if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - BOTTOM_TOLERANCE_PX) {
			return // pinned to the bottom; the list follows the newest row anyway
		}
		// The fold has to have ended completely above the viewport, measured with its old height.
		if (before.top + before.height > scroller.scrollTop + 1) {
			return
		}
		scroller.scrollTop = Math.max(0, scroller.scrollTop - freed)
	}, [ref, expanded])
}
