/**
 * Thinking/Planning indicator with shimmer effect and elapsed time
 *
 * Creates a shimmer effect by cycling a "bright spot" through the text,
 * similar to skeleton loading animations in web UIs.
 */

import { Box, Text } from "ink"
import React, { useEffect, useMemo, useState } from "react"

interface ThinkingIndicatorProps {
	mode?: "act" | "plan"
	startTime?: number // Unix timestamp when thinking started
}

// Shimmer gradient - how much to blend towards white (0 = base color, 1 = white)
// Index 0 = no brightening (far from shimmer), higher = more white (near shimmer center)
const SHIMMER_GRADIENT = [
	0.0, // base color
	0.15,
	0.3,
	0.5,
	0.7,
	0.9, // almost white (shimmer center)
]

const SHIMMER_RADIUS = SHIMMER_GRADIENT.length - 1

// Spinner frames (dots style from ink-spinner)
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

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
 * Blend base color towards white based on factor (0 = base color, 1 = white)
 */
function blendTowardsWhite(baseColor: string, factor: number): string {
	// Base colors - bright and vivid to match Ink's blueBright/yellow
	const colors: Record<string, { r: number; g: number; b: number }> = {
		blueBright: { r: 140, g: 170, b: 255 }, // Light purple-blue
		yellow: { r: 255, g: 255, b: 0 }, // Bright yellow
	}
	const base = colors[baseColor] || colors.blueBright
	const t = Math.max(0, Math.min(1, factor))

	// Lerp from base color towards white (255, 255, 255)
	const r = Math.round(base.r + (255 - base.r) * t)
	const g = Math.round(base.g + (255 - base.g) * t)
	const b = Math.round(base.b + (255 - base.b) * t)

	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

/**
 * Apply shimmer effect to a string by coloring each character
 * based on its position relative to the shimmer center
 */
function ShimmerText({
	text,
	shimmerPos,
	baseColor,
}: {
	text: string
	shimmerPos: number
	baseColor: string
}): React.ReactElement {
	const chars = text.split("")

	return (
		<Text>
			{chars.map((char, i) => {
				// Calculate distance from shimmer center position
				// shimmerPos moves from -SHIMMER_RADIUS to textLen + SHIMMER_RADIUS
				const dist = Math.abs(i - shimmerPos)

				// Map distance to whiteness: closer to shimmer = more white
				const gradientIdx = Math.min(dist, SHIMMER_RADIUS)
				const whiteness = SHIMMER_GRADIENT[SHIMMER_RADIUS - gradientIdx] ?? SHIMMER_GRADIENT[0]

				const color = blendTowardsWhite(baseColor, whiteness)

				return (
					<Text color={color} key={i}>
						{char}
					</Text>
				)
			})}
		</Text>
	)
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ mode = "act", startTime }) => {
	const message = mode === "plan" ? "Planning" : "Thinking"
	const baseColor = mode === "plan" ? "yellow" : "blueBright"

	// Spinner frame index
	const [spinnerFrame, setSpinnerFrame] = useState(0)

	// Shimmer animation position (moves left to right across the text)
	const [shimmerPos, setShimmerPos] = useState(-SHIMMER_RADIUS)

	// Elapsed time state
	const [elapsedMs, setElapsedMs] = useState(0)

	// Full text including spinner
	const spinnerChar = SPINNER_FRAMES[spinnerFrame]
	const fullText = `${spinnerChar} ${message}…`

	// Animate spinner
	useEffect(() => {
		const interval = setInterval(() => {
			setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length)
		}, 80)

		return () => clearInterval(interval)
	}, [])

	// Animate shimmer: move from left edge to right edge, then wrap
	useEffect(() => {
		const interval = setInterval(() => {
			setShimmerPos((prev) => {
				const next = prev + 1
				if (next > fullText.length + SHIMMER_RADIUS) {
					return -SHIMMER_RADIUS
				}
				return next
			})
		}, 60) // Speed of shimmer movement

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
		if (!startTime || elapsedMs < 1000) return null
		return formatElapsedTime(elapsedMs)
	}, [startTime, elapsedMs])

	return (
		<Box>
			<ShimmerText baseColor={baseColor} shimmerPos={shimmerPos} text={fullText} />
			{elapsedStr && (
				<Text color="gray">
					{" "}
					({elapsedStr} · <Text dimColor>esc to interrupt</Text>)
				</Text>
			)}
		</Box>
	)
}
