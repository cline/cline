/**
 * Acting/Planning indicator with spinner, shimmer effect, and elapsed time
 */

import { Box, Text, useInput } from "ink"
import React, { useEffect, useMemo, useState } from "react"
import { COLORS } from "../constants/colors"

interface ThinkingIndicatorProps {
	mode?: "act" | "plan"
	startTime?: number // Unix timestamp when thinking started
	onCancel?: () => void // Called when user presses esc to interrupt
}

// Spinner frames (dots style from ink-spinner)
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const SHIMMER_WIDTH = 3 // How many characters are "bright" at once

/**
 * Format elapsed time as "1m 5s" or "45s"
 */
function formatElapsedTime(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000)
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60

	if (minutes > 0) {
		return `${minutes}m ${seconds}s`
	}
	return `${seconds}s`
}

/**
 * Render text with a shimmer effect using bold for bright characters
 */
const ShimmerText: React.FC<{ text: string; color: string; shimmerPos: number }> = ({ text, color, shimmerPos }) => {
	const chars = text.split("")
	return (
		<Text>
			{chars.map((char, i) => {
				const distFromShimmer = Math.abs(i - shimmerPos)
				const isBright = distFromShimmer <= SHIMMER_WIDTH
				return (
					<Text bold={isBright} color={color} dimColor={!isBright} key={i}>
						{char}
					</Text>
				)
			})}
		</Text>
	)
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ mode = "act", startTime, onCancel }) => {
	const message = mode === "plan" ? "Planning" : "Acting"
	const color = mode === "plan" ? "yellow" : COLORS.primaryBlue

	// Handle esc key to cancel
	useInput((_input, key) => {
		if (key.escape && onCancel) {
			onCancel()
		}
	})

	// Spinner frame index
	const [spinnerFrame, setSpinnerFrame] = useState(0)

	// Shimmer position
	const [shimmerPos, setShimmerPos] = useState(-SHIMMER_WIDTH)

	// Elapsed time state
	const [elapsedMs, setElapsedMs] = useState(0)

	const spinnerChar = SPINNER_FRAMES[spinnerFrame]
	const fullText = `${spinnerChar} ${message}...`

	// Animate spinner
	useEffect(() => {
		const interval = setInterval(() => {
			setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length)
		}, 80)

		return () => clearInterval(interval)
	}, [])

	// Animate shimmer
	useEffect(() => {
		const interval = setInterval(() => {
			setShimmerPos((prev) => {
				const next = prev + 1
				if (next > fullText.length + SHIMMER_WIDTH) {
					return -SHIMMER_WIDTH
				}
				return next
			})
		}, 100)

		return () => clearInterval(interval)
	}, [fullText.length])

	// Update elapsed time
	useEffect(() => {
		if (!startTime) return

		const updateElapsed = () => {
			setElapsedMs(Date.now() - startTime)
		}

		updateElapsed() // Initial update
		const interval = setInterval(updateElapsed, 1000)

		return () => clearInterval(interval)
	}, [startTime])

	const elapsedStr = useMemo(() => {
		if (!startTime) return null
		return formatElapsedTime(elapsedMs)
	}, [startTime, elapsedMs])

	return (
		<Box paddingLeft={1}>
			<ShimmerText color={color} shimmerPos={shimmerPos} text={fullText} />
			{elapsedStr && <Text color="gray"> ({elapsedStr} · esc to interrupt)</Text>}
		</Box>
	)
}
