/**
 * Utility functions for scroll behavior and management
 */

import debounce from "debounce"
import { VirtuosoHandle } from "react-virtuoso"

/**
 * Create a debounced smooth scroll function
 */
export function createSmoothScrollToBottom(virtuosoRef: React.RefObject<VirtuosoHandle>) {
	return debounce(
		() => {
			virtuosoRef.current?.scrollTo({
				top: Number.MAX_SAFE_INTEGER,
				behavior: "smooth",
			})
		},
		10,
		{ immediate: true },
	)
}

/**
 * Scroll to bottom with auto behavior
 */
export function scrollToBottomAuto(virtuosoRef: React.RefObject<VirtuosoHandle>) {
	virtuosoRef.current?.scrollTo({
		top: Number.MAX_SAFE_INTEGER,
		behavior: "auto", // instant causes crash
	})
}

/**
 * Handle wheel events to detect user scroll
 */
export function createWheelHandler(
	scrollContainerRef: React.RefObject<HTMLDivElement>,
	disableAutoScrollRef: React.MutableRefObject<boolean>,
) {
	return (event: Event) => {
		const wheelEvent = event as WheelEvent
		if (wheelEvent.deltaY && wheelEvent.deltaY < 0) {
			if (scrollContainerRef.current?.contains(wheelEvent.target as Node)) {
				// user scrolled up
				disableAutoScrollRef.current = true
			}
		}
	}
}

/**
 * Constants for scroll behavior
 */
export const SCROLL_CONSTANTS = {
	AT_BOTTOM_THRESHOLD: 10,
	VIEWPORT_INCREASE_TOP: 3_000,
	VIEWPORT_INCREASE_BOTTOM: Number.MAX_SAFE_INTEGER,
	FOOTER_HEIGHT: 5,
} as const
