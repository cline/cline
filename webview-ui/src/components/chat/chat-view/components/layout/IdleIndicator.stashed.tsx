/**
 * STASHED CODE - Idle Indicator with MutationObserver
 *
 * This code implements a "Thinking..."/"Working..." indicator that appears after 3 seconds
 * of DOM silence. It was removed from MessagesArea.tsx but preserved here for future use.
 *
 * To re-enable:
 * 1. Import this hook in MessagesArea.tsx
 * 2. Call useIdleIndicator() and get showIdleIndicator state
 * 3. Add the indicator to the Virtuoso Footer component
 */

import { ClineMessage } from "@shared/ExtensionMessage"
import { useEffect, useRef, useState } from "react"

// Idle timeout in milliseconds before showing indicator
const IDLE_TIMEOUT_MS = 3000

/**
 * Hook that detects when the DOM has been idle for IDLE_TIMEOUT_MS
 * Uses MutationObserver to track actual content changes
 */
export function useIdleIndicator(scrollContainerRef: React.RefObject<HTMLDivElement>, clineMessages: ClineMessage[]): boolean {
	const [showIdleIndicator, setShowIdleIndicator] = useState(false)
	const idleTimerRef = useRef<NodeJS.Timeout | null>(null)
	const timerStartTimeRef = useRef<number | null>(null)

	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container) {
			return
		}

		// Check if task is complete
		const isTaskComplete = clineMessages.some(
			(msg) => msg.ask === "completion_result" || msg.say === "completion_result" || msg.ask === "plan_mode_respond",
		)

		if (isTaskComplete) {
			// Don't show indicator if task is complete
			setShowIdleIndicator(false)
			timerStartTimeRef.current = null
			return
		}

		console.log("[IdleIndicator] Setting up MutationObserver")

		const resetIdleTimer = () => {
			// Clear existing timer
			if (idleTimerRef.current) {
				clearTimeout(idleTimerRef.current)
			}

			// Hide indicator immediately when new content arrives
			setShowIdleIndicator(false)

			// Record start time if this is the first mutation
			if (!timerStartTimeRef.current) {
				timerStartTimeRef.current = Date.now()
			}

			// Calculate elapsed and remaining time
			const elapsed = Date.now() - timerStartTimeRef.current
			const remaining = Math.max(0, IDLE_TIMEOUT_MS - elapsed)

			console.log(
				`[IdleIndicator] DOM mutation detected, restarting timer. Elapsed: ${elapsed}ms, Remaining: ${remaining}ms`,
			)

			// Start new timer for remaining duration
			idleTimerRef.current = setTimeout(() => {
				console.log("[IdleIndicator] DOM idle for 3s, showing indicator")
				setShowIdleIndicator(true)
			}, remaining)
		}

		// Observe changes to the chat container
		const observer = new MutationObserver((mutations) => {
			// Only reset timer if there are actual content changes
			const hasContentChange = mutations.some((mutation) => {
				return (
					mutation.type === "childList" ||
					mutation.type === "characterData" ||
					(mutation.type === "attributes" && mutation.attributeName !== "style")
				)
			})

			if (hasContentChange) {
				resetIdleTimer()
			}
		})

		observer.observe(container, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
		})

		// Start initial timer
		resetIdleTimer()

		return () => {
			console.log("[IdleIndicator] Cleaning up MutationObserver")
			observer.disconnect()
			if (idleTimerRef.current) {
				clearTimeout(idleTimerRef.current)
			}
			timerStartTimeRef.current = null
		}
	}, [scrollContainerRef, clineMessages])

	return showIdleIndicator
}

/**
 * Component to render in Virtuoso Footer
 *
 * Usage:
 * <Virtuoso
 *   components={{
 *     Footer: () => (
 *       <div>
 *         <div className="min-h-1" />
 *         {showIdleIndicator && (
 *           <div className="flex items-center text-description text-sm px-4 pt-2.5 pb-2.5">
 *             <div className="ml-1">
 *               <TypewriterText text={mode === "plan" ? "Thinking..." : "Working..."} />
 *             </div>
 *           </div>
 *         )}
 *       </div>
 *     ),
 *   }}
 * />
 */
