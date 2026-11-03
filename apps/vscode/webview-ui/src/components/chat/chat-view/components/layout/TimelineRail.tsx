import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { getPromptTypingMs } from "../../utils/promptTimings"
import {
	formatDurationMinutes,
	formatElapsed,
	formatTimeAgo,
	nearestByRatio,
	resolveChatScroller,
	type TimelineMarker,
	type TimelineTurn,
} from "../../utils/turnTimeline"

interface TimelineRailProps {
	markers: TimelineMarker[]
	turns: TimelineTurn[]
	/** Rail fraction per marker, measured from the rows themselves. */
	positions: number[]
	sessionKey: number | undefined
	onSelect: (marker: TimelineMarker) => void
	scrollContainerRef: RefObject<HTMLElement | null>
}

/** How long the preview stays up after the pointer leaves or the drag ends. */
const PREVIEW_LINGER_MS = 1400

/** Keeps the vertically centred preview box away from the rail's ends so it is never clipped. */
const EDGE_INSET_PERCENT = 7

/**
 * A minimap-style rail beside the scrollbar for travelling through a long task.
 *
 * It marks only what carries the conversation — prompts and final answers — so the ticks double
 * as an outline of the session. Dragging it scrubs between those rows and shows a one-line
 * summary with the wall-clock distance plus, where known, how long the prompt took to type and
 * how long the answer took to arrive.
 *
 * It deliberately sits next to the native scrollbar rather than replacing it: the native thumb
 * still reflects real row heights, while the rail trades that precision for labelled targets.
 */
export const TimelineRail = ({ markers, turns, positions, sessionKey, onSelect, scrollContainerRef }: TimelineRailProps) => {
	const railRef = useRef<HTMLDivElement>(null)
	const draggingRef = useRef(false)
	const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const [activeIndex, setActiveIndex] = useState<number | null>(null)
	const [dragging, setDragging] = useState(false)
	const [scrollRatio, setScrollRatio] = useState(0)

	const marker = activeIndex === null ? undefined : markers[activeIndex]

	// Keep the highlighted tick in sync with manual scrolling.
	useEffect(() => {
		const element = resolveChatScroller(scrollContainerRef.current)
		if (!element || markers.length === 0) {
			return
		}
		const onScroll = () => {
			const max = element.scrollHeight - element.clientHeight
			setScrollRatio(max <= 0 ? 0 : element.scrollTop / max)
		}
		onScroll()
		element.addEventListener("scroll", onScroll, { passive: true })
		return () => element.removeEventListener("scroll", onScroll)
	}, [markers, scrollContainerRef])

	const showFor = useCallback((index: number, ms?: number) => {
		if (hideTimer.current) {
			clearTimeout(hideTimer.current)
			hideTimer.current = undefined
		}
		setActiveIndex(index)
		if (ms !== undefined) {
			hideTimer.current = setTimeout(() => setActiveIndex((current) => (current === index ? null : current)), ms)
		}
	}, [])

	useEffect(() => () => hideTimer.current && clearTimeout(hideTimer.current), [])

	/** Marker under a pointer position, using the same measured positions the ticks are drawn at. */
	const markerAt = useCallback(
		(clientY: number) => {
			const rail = railRef.current
			if (!rail) {
				return -1
			}
			const rect = rail.getBoundingClientRect()
			if (rect.height === 0) {
				return -1
			}
			return nearestByRatio(positions, (clientY - rect.top) / rect.height)
		},
		[positions],
	)

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		const index = markerAt(event.clientY)
		if (index < 0) {
			return
		}
		event.preventDefault()
		event.currentTarget.setPointerCapture(event.pointerId)
		draggingRef.current = true
		setDragging(true)
		showFor(index)
		onSelect(markers[index])
	}

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const index = markerAt(event.clientY)
		if (index < 0) {
			return
		}
		if (draggingRef.current) {
			showFor(index)
			onSelect(markers[index])
			return
		}
		showFor(index, PREVIEW_LINGER_MS)
	}

	const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) {
			return
		}
		draggingRef.current = false
		setDragging(false)
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId)
		}
		showFor(activeIndex ?? 0, PREVIEW_LINGER_MS)
	}

	const current = nearestByRatio(positions, scrollRatio)

	/** Vertical placement for a marker index, falling back to an even spread before first measure. */
	const topFor = (index: number) => {
		const ratio = positions[index] ?? (markers.length > 1 ? index / (markers.length - 1) : 0)
		return `${Math.min(Math.max(ratio * 100, EDGE_INSET_PERCENT), 100 - EDGE_INSET_PERCENT)}%`
	}

	const details = useMemo(() => {
		if (!marker) {
			return [] as string[]
		}
		const turn = turns.find((candidate) => candidate.prompt?.ts === marker.ts || candidate.answer?.ts === marker.ts)
		const lines: string[] = []
		if (marker.kind === "prompt") {
			const typing = sessionKey === undefined ? undefined : getPromptTypingMs(sessionKey, marker.ts)
			if (typing) {
				lines.push(`typed ${formatElapsed(typing)}`)
			}
		}
		if (turn?.prompt && turn.answer) {
			// Empty below a minute, so a fast answer adds no label instead of a meaningless 0s.
			const answer = formatDurationMinutes(turn.answer.ts - turn.prompt.ts)
			if (answer) {
				lines.push(`answer ${answer}`)
			}
		}
		return lines
	}, [marker, sessionKey, turns])

	if (markers.length < 2) {
		return null
	}

	return (
		<div
			className={cn(
				"absolute top-0 bottom-0 z-20 cursor-pointer touch-none select-none transition-all duration-100",
				// Widening while dragging gives the same feedback a scrollbar thumb gives on grab.
				dragging ? "w-4 bg-foreground/5" : "w-3",
			)}
			data-testid="timeline-rail"
			onPointerDown={handlePointerDown}
			onPointerLeave={() => !draggingRef.current && showFor(activeIndex ?? 0, PREVIEW_LINGER_MS)}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			ref={railRef}
			style={{ right: 12 }} // clear of the 12px native scrollbar
		>
			{markers.map((entry, index) => (
				<button
					aria-label={`${entry.kind}: ${entry.summary}`}
					className={cn(
						"absolute right-0 h-[3px] border-0 p-0",
						"transition-all duration-100",
						// Prompt blue, answer green: the two are the only marks on the rail and
						// have to tell apart at 3px. Link blue is distinct from charts-green in
						// both themes, unlike the earlier grey-on-dark.
						entry.kind === "answer" ? "bg-success" : "bg-link",
						index === current || index === activeIndex ? "w-3.5 opacity-100" : "w-2 opacity-60",
					)}
					key={`${entry.ts}-${entry.kind}`}
					onClick={() => {
						onSelect(entry)
						showFor(index, PREVIEW_LINGER_MS)
					}}
					onPointerDown={(event) => event.stopPropagation()}
					onPointerEnter={() => showFor(index, PREVIEW_LINGER_MS)}
					style={{ top: topFor(index) }}
					type="button"
				/>
			))}

			{marker && (
				<div
					className="pointer-events-none absolute right-5 z-30 w-[min(70dvw,18em)] -translate-y-1/2 overflow-hidden rounded p-2 text-xs leading-snug break-words"
					data-testid="timeline-preview"
					style={{
						top: topFor(activeIndex ?? 0),
						// Same tokens the existing floating widget uses (BrowserSettingsMenu):
						// background and foreground come as a matching pair from the theme.
						backgroundColor: "var(--vscode-editorWidget-background)",
						color: "var(--vscode-editorWidget-foreground)",
						border: "1px solid var(--vscode-widget-border)",
						boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
					}}>
					<div className="flex items-baseline justify-between gap-2">
						<span className={cn("min-w-0 font-medium", marker.kind === "answer" ? "text-success" : "text-link")}>
							{marker.summary}
						</span>
						<span className="shrink-0 opacity-70">{formatTimeAgo(marker.ts, Date.now())}</span>
					</div>
					{details.length > 0 && <div className="mt-0.5 opacity-70">{details.join(" · ")}</div>}
				</div>
			)}
		</div>
	)
}
