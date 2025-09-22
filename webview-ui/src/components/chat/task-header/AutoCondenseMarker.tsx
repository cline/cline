import React, { useEffect, useMemo, useState } from "react"

export const AutoCondenseMarker: React.FC<{
	threshold: number
	usage: number
	isContextWindowHoverOpen?: boolean
	shouldAnimate?: boolean
}> = ({ threshold, usage, isContextWindowHoverOpen, shouldAnimate = false }) => {
	const [isAnimating, setIsAnimating] = useState(false)
	const [animatedPosition, setAnimatedPosition] = useState(0)
	const [animatedPercentage, setAnimatedPercentage] = useState(0)
	const [showPercentageAfterAnimation, setShowPercentageAfterAnimation] = useState(false)
	const [isFadingOut, setIsFadingOut] = useState(false)
	const [previousThreshold, setPreviousThreshold] = useState(threshold)

	// Animation effect when shouldAnimate prop changes (initial load)
	useEffect(() => {
		let animationFrameId: number | null = null
		let fadeOutTimeoutId: NodeJS.Timeout | null = null
		let hideTimeoutId: NodeJS.Timeout | null = null

		if (shouldAnimate && threshold > 0) {
			setIsAnimating(true)
			setAnimatedPosition(0)
			setAnimatedPercentage(0)

			const targetPosition = threshold * 100
			const duration = 1200 // ms - slowed down from 800ms
			const startTime = Date.now()

			const animate = () => {
				const elapsed = Date.now() - startTime
				const progress = Math.min(elapsed / duration, 1)

				// Ease-out animation curve
				const easeOut = 1 - (1 - progress) ** 3

				const currentPosition = easeOut * targetPosition
				const currentPercentage = easeOut * targetPosition

				setAnimatedPosition(currentPosition)
				setAnimatedPercentage(currentPercentage)

				if (progress < 1) {
					animationFrameId = requestAnimationFrame(animate)
				} else {
					setIsAnimating(false)
					setShowPercentageAfterAnimation(true)
					// Start fade out after 1 second
					fadeOutTimeoutId = setTimeout(() => {
						setIsFadingOut(true)
						// Completely hide after fade transition
						hideTimeoutId = setTimeout(() => {
							setShowPercentageAfterAnimation(false)
							setIsFadingOut(false)
						}, 300) // 300ms fade duration
					}, 1000)
				}
			}

			animationFrameId = requestAnimationFrame(animate)
		}

		// Cleanup function
		return () => {
			if (animationFrameId !== null) {
				cancelAnimationFrame(animationFrameId)
			}
			if (fadeOutTimeoutId !== null) {
				clearTimeout(fadeOutTimeoutId)
			}
			if (hideTimeoutId !== null) {
				clearTimeout(hideTimeoutId)
			}
		}
	}, [shouldAnimate, threshold])

	// Animation effect when threshold changes (user clicks progress bar)
	useEffect(() => {
		let animationFrameId: number | null = null

		if (threshold !== previousThreshold && previousThreshold > 0 && threshold > 0 && !shouldAnimate) {
			setIsAnimating(true)
			setAnimatedPosition(previousThreshold * 100)
			setAnimatedPercentage(previousThreshold * 100)

			const startPosition = previousThreshold * 100
			const targetPosition = threshold * 100
			const duration = 400 // ms - faster for threshold changes
			const startTime = Date.now()

			const animate = () => {
				const elapsed = Date.now() - startTime
				const progress = Math.min(elapsed / duration, 1)

				// Ease-out animation curve
				const easeOut = 1 - (1 - progress) ** 3

				const currentPosition = startPosition + (targetPosition - startPosition) * easeOut
				const currentPercentage = startPosition + (targetPosition - startPosition) * easeOut

				setAnimatedPosition(currentPosition)
				setAnimatedPercentage(currentPercentage)

				if (progress < 1) {
					animationFrameId = requestAnimationFrame(animate)
				} else {
					setIsAnimating(false)
				}
			}

			animationFrameId = requestAnimationFrame(animate)
		}

		setPreviousThreshold(threshold)

		// Cleanup function
		return () => {
			if (animationFrameId !== null) {
				cancelAnimationFrame(animationFrameId)
			}
		}
	}, [threshold, previousThreshold, shouldAnimate])

	// The marker position is calculated based on the threshold percentage
	// It goes over the progress bar to indicate where the auto-condense will trigger
	// and it should highlight from what the current percentage (usage) is
	// to the threshold percentage
	const marker = useMemo(() => {
		const _threshold = threshold * 100
		const position = isAnimating ? animatedPosition : _threshold
		const displayPercentage = isAnimating ? animatedPercentage : _threshold

		return {
			start: position + "%",
			label: displayPercentage.toFixed(0),
			end: usage >= threshold * 100 ? usage - _threshold + "%" : undefined,
		}
	}, [threshold, usage, isAnimating, animatedPosition, animatedPercentage])

	if (!threshold) {
		return null
	}

	return (
		<div className="flex-1" id="auto-condense-threshold-marker">
			<div
				className={`absolute top-0 bottom-0 h-full cursor-pointer pointer-events-none z-10 bg-button-background shadow-lg outline-button-background/80 outline-0.5 w-1.5 ${
					isAnimating ? "" : "transition-all duration-75"
				}`}
				style={{ left: marker.start }}>
				{(isContextWindowHoverOpen || isAnimating || showPercentageAfterAnimation) && (
					<div
						className={`absolute -top-4 -left-1 text-button-background/80 font-mono text-xs transition-opacity duration-300 ${
							isFadingOut ? "opacity-0" : "opacity-100"
						}`}>
						{marker.label}%
					</div>
				)}
				{marker.end !== undefined && (
					<div
						className="absolute top-0 bottom-0 h-full z-20 bg-black/45"
						style={{ left: marker.start, width: marker.end }}></div>
				)}
			</div>
		</div>
	)
}
AutoCondenseMarker.displayName = "AutoCondenseMarker"
