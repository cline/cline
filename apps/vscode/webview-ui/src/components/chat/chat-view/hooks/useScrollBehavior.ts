import { ClineMessage } from "@shared/ExtensionMessage"
import debounce from "debounce"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import { ListRange, VirtuosoHandle } from "react-virtuoso"
import { getLatestUserPrompt } from "../utils/messageUtils"
import { ScrollBehavior } from "../types/chatTypes"

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
	showScrollToBottom: boolean
	setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>
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

	// State
	const [showScrollToBottom, setShowScrollToBottom] = useState(false)
	const [isAtBottom, setIsAtBottom] = useState(false)
	const [pendingScrollToMessage, setPendingScrollToMessage] = useState<number | null>(null)
	const [scrolledPastUserMessage, setScrolledPastUserMessage] = useState<ClineMessage | null>(null)

	const latestUserPrompt = useMemo(() => getLatestUserPrompt(messages), [messages])

	const checkScrolledPastUserMessage = useCallback(() => {
		const container = scrollContainerRef.current
		if (!container || !latestUserPrompt) {
			setScrolledPastUserMessage(null)
			return
		}
		// The initial task lives in TaskHeader, outside Virtuoso. Give it the same readable preview.
		if (latestUserPrompt.ts === messages[0]?.ts) {
			setScrolledPastUserMessage(latestUserPrompt)
			return
		}
		const element = container.querySelector<HTMLElement>(`[data-message-ts="${latestUserPrompt.ts}"]`)
		const top = container.getBoundingClientRect().top
		const passed = element
			? element.getBoundingClientRect().top < top - 1
			: [...container.querySelectorAll<HTMLElement>("[data-message-ts]")].some(
				(row) => Number(row.dataset.messageTs) > latestUserPrompt.ts && row.getBoundingClientRect().bottom > top,
			)
		setScrolledPastUserMessage(passed ? latestUserPrompt : null)
	}, [latestUserPrompt, messages])

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

	// Virtualized rows can mount after the scroll event, including during automatic scrolling.
	const handleRangeChanged = useCallback((_range: ListRange) => {
		requestAnimationFrame(checkScrolledPastUserMessage)
	}, [checkScrolledPastUserMessage])
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
					const messageInGroup = group.some((msg) => msg.ts === targetMessage.ts)
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

				// Use scrollToIndex with offset - Virtuoso handles this more reliably than manual scrollTo
				requestAnimationFrame(() => {
					virtuosoRef.current?.scrollToIndex({
						index: groupIndex,
						align: "start",
						behavior: "smooth",
					})
				})
			}
		},
		[messages, visibleMessages, groupedMessages],
	)

	// scroll when user toggles certain rows
	const toggleRowExpansion = useCallback(
		(ts: number) => {
			const isCollapsing = expandedRows[ts] ?? false
			const lastGroup = groupedMessages.at(-1)
			const isLast = Array.isArray(lastGroup) ? lastGroup[0].ts === ts : lastGroup?.ts === ts
			const secondToLastGroup = groupedMessages.at(-2)
			const isSecondToLast = Array.isArray(secondToLastGroup)
				? secondToLastGroup[0].ts === ts
				: secondToLastGroup?.ts === ts

			const isLastCollapsedApiReq =
				isLast &&
				!Array.isArray(lastGroup) && // Make sure it's not a browser session group
				lastGroup?.say === "api_req_started" &&
				!expandedRows[lastGroup.ts]

			setExpandedRows((prev) => ({
				...prev,
				[ts]: !prev[ts],
			}))

			// disable auto scroll when user expands row
			if (!isCollapsing) {
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

	const handleRowHeightChange = useCallback(
		(isTaller: boolean) => {
			if (!disableAutoScrollRef.current) {
				if (isTaller) {
					scrollToBottomSmooth()
				} else {
					setTimeout(() => {
						scrollToBottomAuto()
					}, 0)
				}
			}
		},
		[scrollToBottomSmooth, scrollToBottomAuto],
	)

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

	useEffect(() => {
		if (!messages?.length) {
			setShowScrollToBottom(false)
		}
	}, [messages.length])

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

	return {
		virtuosoRef,
		scrollContainerRef,
		disableAutoScrollRef,
		scrollToBottomSmooth,
		scrollToBottomAuto,
		scrollToMessage,
		toggleRowExpansion,
		handleRowHeightChange,
		showScrollToBottom,
		setShowScrollToBottom,
		isAtBottom,
		setIsAtBottom,
		pendingScrollToMessage,
		setPendingScrollToMessage,
		scrolledPastUserMessage,
		handleRangeChanged,
	}
}
