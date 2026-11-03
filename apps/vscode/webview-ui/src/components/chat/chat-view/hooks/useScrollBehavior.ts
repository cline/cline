import { ClineMessage } from "@shared/ExtensionMessage"
import debounce from "debounce"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import { ListRange, VirtuosoHandle } from "react-virtuoso"
import { ScrollBehavior } from "../types/chatTypes"
import { flattenActivityGroup, getGroupHeadMessage } from "../utils/activityFolding"
import { resolveChatScroller } from "../utils/turnTimeline"

// Height of the sticky user message header (padding + content)
const STICKY_HEADER_HEIGHT = 32

/**
 * Distance from the bottom that still counts as "pinned to the tail". Matches the threshold the
 * list itself reports `atBottom` with (`MessagesArea`), so the two never disagree by a hair.
 */
export const BOTTOM_TOLERANCE_PX = 12

/** How long the reading-position lock stands down after a programmatic scroll, so it cannot fight the animation. */
const PROGRAMMATIC_SCROLL_GRACE_MS = 800

/**
 * Custom hook for managing scroll behavior
 * Handles auto-scrolling, manual scrolling, and scroll-to-message functionality
 */
export function useScrollBehavior(
	messages: ClineMessage[],
	visibleMessages: ClineMessage[],
	groupedMessages: (ClineMessage | ClineMessage[])[],
	expandedRows: Record<number, boolean>,
	setExpandedRows: React.Dispatch<React.SetStateAction<Record<number, boolean>>>,
): ScrollBehavior & {
	isAtBottom: boolean
	setIsAtBottom: React.Dispatch<React.SetStateAction<boolean>>
	pendingScrollToMessage: number | null
	setPendingScrollToMessage: React.Dispatch<React.SetStateAction<number | null>>
	scrolledPastUserMessage: ClineMessage | null
	handleRangeChanged: (range: ListRange) => void
} {
	// Refs
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const disableAutoScrollRef = useRef(false)
	const layoutSettleScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	/** Distance to the bottom at the previous commit — what the reading-position lock restores. */
	const readingPositionRef = useRef<{ scrollHeight: number; distanceFromBottom: number } | undefined>(undefined)
	/** Until when a programmatic scroll owns the scroller and the lock has to keep its hands off. */
	const scrollGraceUntilRef = useRef(0)

	// State
	const [isAtBottom, setIsAtBottom] = useState(false)
	const [pendingScrollToMessage, setPendingScrollToMessage] = useState<number | null>(null)
	const [scrolledPastUserMessage, setScrolledPastUserMessage] = useState<ClineMessage | null>(null)

	// Find all user feedback messages
	const userFeedbackMessages = useMemo(() => {
		return visibleMessages.filter((msg) => msg.say === "user_feedback")
	}, [visibleMessages])

	// Track scroll position to detect which user message has been scrolled past
	// Shows the most recent user message that's above the current viewport
	const checkScrolledPastUserMessage = useCallback(() => {
		const scrollContainer = scrollContainerRef.current
		if (!scrollContainer || userFeedbackMessages.length === 0) {
			setScrolledPastUserMessage(null)
			return
		}

		const containerRect = scrollContainer.getBoundingClientRect()

		// Find the most recent (last in order) user message that's been scrolled past
		// We iterate from the end to find the latest one that's above the viewport
		let mostRecentScrolledPast: ClineMessage | null = null

		// Track if we've found any visible message element in the DOM
		// This helps us determine if missing elements are above or below viewport
		let foundAnyVisibleElement = false

		for (let i = userFeedbackMessages.length - 1; i >= 0; i--) {
			const msg = userFeedbackMessages[i]
			const messageElement = scrollContainer.querySelector(`[data-message-ts="${msg.ts}"]`) as HTMLElement

			if (messageElement) {
				foundAnyVisibleElement = true
				const messageRect = messageElement.getBoundingClientRect()
				// Message is scrolled past if its bottom edge is above (or near) the container's top
				// Add a small threshold so the pin appears slightly before message fully scrolls out
				const threshold = 10
				if (messageRect.bottom < containerRect.top + threshold) {
					mostRecentScrolledPast = msg
					break // Found the most recent one that's scrolled past
				}
			} else {
				// Element not in DOM - it's virtualized out
				// Only consider it scrolled past if we've already found a visible element after it
				// (meaning this missing element is above the viewport, not below)
				if (foundAnyVisibleElement) {
					mostRecentScrolledPast = msg
					break
				}
				// If we haven't found any visible elements yet, this message might be
				// below the viewport, so continue looking for visible elements
			}
		}

		setScrolledPastUserMessage(mostRecentScrolledPast)
	}, [userFeedbackMessages])

	// Use scroll event listener - attach to the scrollable element inside the container
	useEffect(() => {
		const scrollContainer = scrollContainerRef.current
		if (!scrollContainer) {
			return
		}

		// The scrollable element is the Virtuoso scroller or a child with overflow
		const findScrollableElement = () => {
			// Try finding the Virtuoso scroller
			const virtuosoScroller = scrollContainer.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement
			if (virtuosoScroller) {
				return virtuosoScroller
			}
			// Fallback to the first child with scrollable class
			const scrollable = scrollContainer.querySelector(".scrollable") as HTMLElement
			return scrollable || scrollContainer
		}

		const scrollableElement = findScrollableElement()

		const handleScroll = () => {
			checkScrolledPastUserMessage()
		}

		scrollableElement.addEventListener("scroll", handleScroll, { passive: true })

		// Also check on mount and when dependencies change
		checkScrolledPastUserMessage()

		return () => {
			scrollableElement.removeEventListener("scroll", handleScroll)
		}
	}, [checkScrolledPastUserMessage])

	// Handler for when visible range changes in Virtuoso (kept for compatibility but not used for sticky)
	const handleRangeChanged = useCallback((_range: ListRange) => {
		// Range changed callback - we now use scroll position instead
		// but keep this for potential future use
	}, [])
	const scrollToBottomSmooth = useMemo(
		() =>
			debounce(
				() => {
					virtuosoRef.current?.scrollTo({
						top: Number.MAX_SAFE_INTEGER,
						behavior: "smooth",
					})
				},
				10,
				{ immediate: true },
			),
		[],
	)

	// Smooth scroll to bottom with debounce
	const scrollToBottomAuto = useCallback(() => {
		virtuosoRef.current?.scrollTo({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto", // instant causes crash
		})
	}, [])

	const scrollToMessage = useCallback(
		(messageIndex: number) => {
			setPendingScrollToMessage(messageIndex)

			const targetMessage = messages[messageIndex]
			if (!targetMessage) {
				setPendingScrollToMessage(null)
				return
			}

			const visibleIndex = visibleMessages.findIndex((msg) => msg.ts === targetMessage.ts)
			if (visibleIndex === -1) {
				setPendingScrollToMessage(null)
				return
			}

			let groupIndex = -1

			for (let i = 0; i < groupedMessages.length; i++) {
				const group = groupedMessages[i]
				if (Array.isArray(group)) {
					// Activity folds nest their rows, so flatten before looking for the message.
					const messageInGroup = flattenActivityGroup(group).some((msg) => msg.ts === targetMessage.ts)
					if (messageInGroup) {
						groupIndex = i
						break
					}
				} else {
					if (group.ts === targetMessage.ts) {
						groupIndex = i
						break
					}
				}
			}

			if (groupIndex !== -1) {
				setPendingScrollToMessage(null)
				disableAutoScrollRef.current = true
				// The glide to the target is a programmatic scroll: the lock would read the frames
				// it passes as content moving under the reader and pull them back.
				scrollGraceUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_GRACE_MS

				// Check if this is the first user feedback message (no sticky header would show when scrolling to it)
				const isFirstUserMessage =
					groupIndex === 0 || !visibleMessages.slice(0, visibleIndex).some((msg) => msg.say === "user_feedback")

				const stickyHeaderOffset = isFirstUserMessage ? 0 : STICKY_HEADER_HEIGHT

				// Use scrollToIndex with offset - Virtuoso handles this more reliably than manual scrollTo
				requestAnimationFrame(() => {
					virtuosoRef.current?.scrollToIndex({
						index: groupIndex,
						align: "start",
						behavior: "smooth",
						offset: -stickyHeaderOffset,
					})
				})
			}
		},
		[messages, visibleMessages, groupedMessages],
	)

	// scroll when user toggles certain rows
	const toggleRowExpansion = useCallback(
		(ts: number, options?: { preserveAutoScroll?: boolean; next?: boolean }) => {
			const isCollapsing = options?.next !== undefined ? !options.next : (expandedRows[ts] ?? false)
			const lastGroup = groupedMessages.at(-1)
			const isLast = Array.isArray(lastGroup) ? getGroupHeadMessage(lastGroup)?.ts === ts : lastGroup?.ts === ts
			const secondToLastGroup = groupedMessages.at(-2)
			const isSecondToLast = Array.isArray(secondToLastGroup)
				? getGroupHeadMessage(secondToLastGroup)?.ts === ts
				: secondToLastGroup?.ts === ts

			const isLastCollapsedApiReq =
				isLast &&
				!Array.isArray(lastGroup) && // Make sure it's not a browser session group
				lastGroup?.say === "api_req_started" &&
				!expandedRows[lastGroup.ts]

			setExpandedRows((prev) => ({
				...prev,
				[ts]: options?.next !== undefined ? options.next : !prev[ts],
			}))

			// Disable auto-scroll when the user expands a row. Programmatic expansions
			// for active command output should keep bottom pinning engaged.
			if (!isCollapsing && !options?.preserveAutoScroll) {
				disableAutoScrollRef.current = true
			}
			// Only scroll on collapse, never on expand - expanding should stay in place
			if (isCollapsing && isAtBottom) {
				const timer = setTimeout(() => {
					scrollToBottomAuto()
				}, 0)
				return () => clearTimeout(timer)
			}
			if (isCollapsing && (isLast || isSecondToLast)) {
				if (isSecondToLast && !isLastCollapsedApiReq) {
					return
				}
				const timer = setTimeout(() => {
					scrollToBottomAuto()
				}, 0)
				return () => clearTimeout(timer)
			}
			// When expanding, don't scroll - let the element expand in place
		},
		[groupedMessages, expandedRows, scrollToBottomAuto, isAtBottom],
	)

	const clearLayoutSettleScrollTimers = useCallback(() => {
		if (layoutSettleScrollTimerRef.current !== null) {
			clearTimeout(layoutSettleScrollTimerRef.current)
			layoutSettleScrollTimerRef.current = null
		}
	}, [])

	const keepPinnedToBottomAfterLayout = useCallback(() => {
		if (disableAutoScrollRef.current) {
			return
		}

		if (layoutSettleScrollTimerRef.current !== null) {
			clearTimeout(layoutSettleScrollTimerRef.current)
		}
		layoutSettleScrollTimerRef.current = setTimeout(() => {
			if (!disableAutoScrollRef.current) {
				scrollToBottomSmooth()
			}
			layoutSettleScrollTimerRef.current = null
		}, 500)
	}, [scrollToBottomSmooth])

	const handleRowHeightChange = useCallback(
		(_isTaller: boolean) => {
			keepPinnedToBottomAfterLayout()
		},
		[keepPinnedToBottomAfterLayout],
	)

	const handleLastRowContentChange = useCallback(() => {
		keepPinnedToBottomAfterLayout()
	}, [keepPinnedToBottomAfterLayout])

	const notifyProgrammaticScroll = useCallback(() => {
		scrollGraceUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_GRACE_MS
	}, [])

	useEffect(() => clearLayoutSettleScrollTimers, [clearLayoutSettleScrollTimers])

	useEffect(() => {
		if (!disableAutoScrollRef.current) {
			scrollToBottomSmooth()
			setTimeout(() => {
				if (!disableAutoScrollRef.current) {
					scrollToBottomAuto()
				}
			}, 40)
			setTimeout(() => {
				if (!disableAutoScrollRef.current) {
					scrollToBottomAuto()
				}
			}, 70)
			// return () => clearTimeout(timer) // dont cleanup since if visibleMessages.length changes it cancels.
		}
	}, [groupedMessages.length, scrollToBottomSmooth, scrollToBottomAuto])

	useEffect(() => {
		if (pendingScrollToMessage !== null) {
			scrollToMessage(pendingScrollToMessage)
		}
	}, [pendingScrollToMessage, groupedMessages, scrollToMessage])

	const handleWheel = useCallback((event: Event) => {
		const wheelEvent = event as WheelEvent
		if (wheelEvent.deltaY && wheelEvent.deltaY < 0) {
			if (scrollContainerRef.current?.contains(wheelEvent.target as Node)) {
				// user scrolled up
				disableAutoScrollRef.current = true
			}
		}
	}, [])
	useEvent("wheel", handleWheel, window, { passive: true }) // passive improves scrolling performance

	/**
	 * Leaving the tail counts however it happens, not only with the wheel.
	 *
	 * `handleWheel` catches scrolling up, but dragging the scrollbar thumb, PageUp or a swipe leaves
	 * the bottom just the same while auto-scroll stayed armed — every row the agent then produced
	 * pulled the view back down, which is what reads as jumping back and forth. The geometry itself
	 * is the honest signal, so the flag follows it.
	 */
	useEffect(() => {
		const handleAnyScroll = (event: Event) => {
			const container = scrollContainerRef.current
			const scroller = resolveChatScroller(container)
			if (!container || !scroller || !container.contains(event.target as Node)) {
				return
			}
			const distance = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
			if (distance > BOTTOM_TOLERANCE_PX) {
				disableAutoScrollRef.current = true
			} else if (Date.now() >= scrollGraceUntilRef.current) {
				disableAutoScrollRef.current = false
			}
		}
		// Scroll events do not bubble; capturing them on the window catches the list's own, also
		// after Virtuoso re-creates its scroller when the task changes.
		window.addEventListener("scroll", handleAnyScroll, { passive: true, capture: true })
		return () => window.removeEventListener("scroll", handleAnyScroll, { capture: true })
	}, [])

	/**
	 * Keeps the reading position still while the agent keeps producing output.
	 *
	 * Rows appended below the viewport cannot move anything, but a fold collapsing above it, a
	 * streaming row growing or a re-measure does — and the list runs with `overflow-anchor: none`,
	 * which upstream needs, so the browser hands no compensation back. The distance to the bottom is
	 * therefore remembered per commit and restored whenever the content height changed while the
	 * reader is not pinned to the tail. Restoring the *distance* rather than an index is what keeps
	 * the text under the eyes: content growing inside the viewport still grows downwards.
	 *
	 * Runs before paint, so the correction never shows as a second jump. When another mechanism has
	 * already kept that distance constant — the fold anchoring does exactly that — the measurement
	 * matches and nothing is corrected twice.
	 */
	useLayoutEffect(() => {
		const scroller = resolveChatScroller(scrollContainerRef.current)
		if (!scroller) {
			readingPositionRef.current = undefined
			return
		}
		const distance = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
		const previous = readingPositionRef.current
		readingPositionRef.current = { scrollHeight: scroller.scrollHeight, distanceFromBottom: distance }
		if (!previous || Date.now() < scrollGraceUntilRef.current) {
			return
		}
		const contentUntouched = scroller.scrollHeight === previous.scrollHeight || distance === previous.distanceFromBottom
		// Pinned to the tail: output arriving there is exactly what following is for.
		if (contentUntouched || previous.distanceFromBottom <= BOTTOM_TOLERANCE_PX) {
			return
		}
		scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - previous.distanceFromBottom
		readingPositionRef.current = {
			scrollHeight: scroller.scrollHeight,
			distanceFromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
		}
	})

	return {
		virtuosoRef,
		scrollContainerRef,
		disableAutoScrollRef,
		scrollToBottomSmooth,
		scrollToBottomAuto,
		scrollToMessage,
		toggleRowExpansion,
		handleRowHeightChange,
		handleLastRowContentChange,
		notifyProgrammaticScroll,
		isAtBottom,
		setIsAtBottom,
		pendingScrollToMessage,
		setPendingScrollToMessage,
		scrolledPastUserMessage,
		handleRangeChanged,
	}
}
