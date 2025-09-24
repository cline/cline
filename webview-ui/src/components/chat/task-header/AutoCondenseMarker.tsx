import { cn } from "@heroui/react"
import React, { useEffect, useMemo, useRef, useState } from "react"

export const AutoCondenseMarker: React.FC<{
	threshold: number
	usage: number
	isContextWindowHoverOpen?: boolean
	shouldAnimate?: boolean
}> = ({ threshold, usage, isContextWindowHoverOpen, shouldAnimate = false }) => {
	const [isAnimating, setIsAnimating] = useState(false)
	const [animatedPosition, setAnimatedPosition] = useState(0)
	const [showPercentageAfterAnimation, setShowPercentageAfterAnimation] = useState(false)
	const [isFadingOut, setIsFadingOut] = useState(false)

	// Refs to store animation frame and timeout IDs for cleanup
	const animationFrameRef = useRef<number | null>(null)
	const fadeOutTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	// Animation effect when shouldAnimate prop changes (initial load)
	useEffect(() => {
		// Cleanup function to cancel any pending animations or timeouts
		const cleanup = () => {
			if (animationFrameRef.current !== null) {
				cancelAnimationFrame(animationFrameRef.current)
				animationFrameRef.current = null
			}
			if (fadeOutTimeoutRef.current !== null) {
				clearTimeout(fadeOutTimeoutRef.current)
				fadeOutTimeoutRef.current = null
			}
			if (hideTimeoutRef.current !== null) {
				clearTimeout(hideTimeoutRef.current)
				hideTimeoutRef.current = null
			}
		}

		if (shouldAnimate && threshold > 0) {
			// Clean up any existing animations before starting new one
			cleanup()

			setIsAnimating(true)
			const targetPosition = threshold * 100
			const duration = 1200 // ms - slowed down from 800ms
			const startTime = Date.now()

			const animate = () => {
				const elapsed = Date.now() - startTime
				const progress = Math.min(elapsed / duration, 1)
				// Ease-out animation curve
				const easeOut = 1 - (1 - progress) ** 3
				const currentPosition = easeOut * targetPosition
				setAnimatedPosition(currentPosition)

				if (progress < 1) {
					animationFrameRef.current = requestAnimationFrame(animate)
				} else {
					animationFrameRef.current = null
					setIsAnimating(false)
					setShowPercentageAfterAnimation(true)
					// Start fade out after 1 second
					fadeOutTimeoutRef.current = setTimeout(() => {
						setIsFadingOut(true)
						// Completely hide after fade transition
						hideTimeoutRef.current = setTimeout(() => {
							setShowPercentageAfterAnimation(false)
							setIsFadingOut(false)
							hideTimeoutRef.current = null
							setAnimatedPosition(threshold * 100) // Ensure it ends exactly at threshold
						}, 300) // 300ms fade duration
						fadeOutTimeoutRef.current = null
					}, 1000)
				}
			}

			animationFrameRef.current = requestAnimationFrame(animate)
		}

		// Cleanup on unmount or when dependencies change
		return cleanup
	}, [shouldAnimate, threshold])

	// The marker position is calculated based on the threshold percentage
	// It goes over the progress bar to indicate where the auto-condense will trigger
	// and it should highlight from what the current percentage (usage) is
	// to the threshold percentage
	const marker = useMemo(() => {
		const _threshold = threshold * 100
		// Always use the current threshold for position and label - animation only affects visual movement
		const position = _threshold
		const startingPosition = isAnimating ? animatedPosition : position

		return {
			start: startingPosition + "%",
			label: startingPosition.toFixed(0),
			end: usage > startingPosition ? usage - startingPosition + "%" : 0,
		}
	}, [threshold, usage, isAnimating, animatedPosition])

	if (!threshold) {
		return null
	}

	return (
		<div className="flex-1" id="auto-condense-threshold-marker">
			<div
				className={cn(
					"absolute top-0 bottom-0 h-full cursor-pointer pointer-events-none z-10 bg-button-background shadow-lg w-1",
					{
						"transition-all duration-75": !isAnimating,
					},
				)}
				style={{
					left: marker.start,
					transform: isAnimating ? `translateX(${animatedPosition - threshold * 100}%)` : "translateX(0)",
				}}>
				{(isContextWindowHoverOpen || isAnimating || showPercentageAfterAnimation) && (
					<div
						className={cn("absolute -top-4 -left-1 text-button-background font-mono text-xs", {
							"opacity-0": isFadingOut,
						})}>
						{marker.label}%
					</div>
				)}
			</div>
		</div>
	)
}
AutoCondenseMarker.displayName = "AutoCondenseMarker"
