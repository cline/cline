import { type RefObject, useCallback, useEffect, useRef, useState } from "react"
import { interpolateRatios, resolveChatScroller, type TimelineMarker } from "../utils/turnTimeline"

/** Measured positions are remembered across scrolls; this bounds that memory. */
const MAX_REMEMBERED = 400

/**
 * Where each timeline marker sits on the rail, as a 0..1 fraction of the scrollable range.
 *
 * Measured from the rows themselves (`data-message-ts`, stamped by `MessageRenderer`) so a marker
 * sits exactly where the scrollbar thumb will be once that row is on screen. Index-based guessing
 * drifted badly: a folded activity row is a fraction of the height of an answer.
 *
 * Two things make this work with a virtualised list, where only a few rows exist at a time:
 *
 * 1. Measurements are **remembered**, so scrolling through the conversation accumulates anchors
 *    instead of only ever knowing the rows currently on screen.
 * 2. The ends of the list are anchored at 0 and 1. Without them every marker above the first
 *    measured row was clamped onto it, which made the whole upper half of the rail collapse into
 *    a single visible tick.
 */
export function useTimelinePositions(
	markers: TimelineMarker[],
	totalItems: number,
	scrollContainerRef: RefObject<HTMLElement | null>,
): number[] {
	const [positions, setPositions] = useState<number[]>([])
	const remembered = useRef(new Map<number, number>())

	const measure = useCallback(() => {
		// The ref points at the layout wrapper; only the virtualiser's own element scrolls.
		const element = resolveChatScroller(scrollContainerRef.current)
		if (!element || markers.length === 0) {
			setPositions([])
			return
		}
		const range = element.scrollHeight - element.clientHeight
		if (range <= 0) {
			// Nothing to scroll yet: an even spread beats stacking every tick on one spot.
			setPositions(markers.map((_, order) => (markers.length > 1 ? order / (markers.length - 1) : 0)))
			return
		}
		const containerTop = element.getBoundingClientRect().top
		for (const marker of markers) {
			const row = element.querySelector(`[data-message-ts="${marker.ts}"]`)
			if (!row) {
				continue
			}
			// offsetTop depends on the nearest positioned ancestor, so measure against the scroller.
			const top = row.getBoundingClientRect().top - containerTop + element.scrollTop
			remembered.current.set(marker.ts, Math.min(Math.max(top / range, 0), 1))
		}
		// Scrolling through a long task can otherwise grow without bound.
		if (remembered.current.size > MAX_REMEMBERED) {
			for (const stale of [...remembered.current.keys()].slice(0, remembered.current.size - MAX_REMEMBERED)) {
				remembered.current.delete(stale)
			}
		}

		const anchors = markers
			.filter((marker) => remembered.current.has(marker.ts))
			.map((marker) => ({ listIndex: marker.listIndex, ratio: remembered.current.get(marker.ts) as number }))
		// Pin the extremes so unmeasured markers interpolate across the whole rail.
		if (!anchors.some((anchor) => anchor.listIndex === 0)) {
			anchors.unshift({ listIndex: 0, ratio: 0 })
		}
		const lastIndex = Math.max(totalItems - 1, 0)
		if (!anchors.some((anchor) => anchor.listIndex === lastIndex)) {
			anchors.push({ listIndex: lastIndex, ratio: 1 })
		}
		setPositions(interpolateRatios(markers, anchors))
	}, [markers, scrollContainerRef, totalItems])

	useEffect(() => {
		measure()
		const element = resolveChatScroller(scrollContainerRef.current)
		if (!element) {
			return
		}
		let frame = 0
		const schedule = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(measure)
		}
		element.addEventListener("scroll", schedule, { passive: true })
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule)
		observer?.observe(element)
		if (element.firstElementChild) {
			observer?.observe(element.firstElementChild)
		}
		// Zoom and font-size changes resize the rows without resizing the scroller itself.
		window.addEventListener("resize", schedule)
		return () => {
			cancelAnimationFrame(frame)
			element.removeEventListener("scroll", schedule)
			window.removeEventListener("resize", schedule)
			observer?.disconnect()
		}
	}, [measure, scrollContainerRef])

	return positions
}
