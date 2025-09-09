"use client"

import { useMemo } from "react"
import { ScatterChart, Scatter, XAxis, YAxis, Customized, Cross, LabelList } from "recharts"

import { formatCurrency } from "@/lib"
import { ChartContainer, ChartTooltip, ChartConfig } from "@/components/ui"

import type { EvalRun } from "./types"

type PlotProps = {
	tableData: (EvalRun & { label: string; cost: number })[]
}

type LabelPosition = "top" | "bottom" | "left" | "right"

export const Plot = ({ tableData }: PlotProps) => {
	const chartData = useMemo(() => tableData.filter(({ cost }) => cost < 50), [tableData])

	const chartConfig = useMemo(
		() => chartData.reduce((acc, run) => ({ ...acc, [run.label]: run }), {} as ChartConfig),
		[chartData],
	)

	// Calculate label positions to avoid overlaps.
	const labelPositions = useMemo(() => {
		const positions: Record<string, LabelPosition> = {}

		// Track placed labels with their approximate bounds.
		const placedLabels: Array<{
			cost: number
			score: number
			label: string
			position: LabelPosition
		}> = []

		// Helper function to check if two labels would overlap.
		const wouldLabelsOverlap = (
			p1: { cost: number; score: number; position: LabelPosition },
			p2: { cost: number; score: number; position: LabelPosition },
		): boolean => {
			// Approximate thresholds for overlap detection.
			const horizontalThreshold = 4 // Cost units.
			const verticalThreshold = 5 // Score units.

			const costDiff = Math.abs(p1.cost - p2.cost)
			const scoreDiff = Math.abs(p1.score - p2.score)

			// If points are far apart, no overlap.
			if (costDiff > horizontalThreshold * 2 || scoreDiff > verticalThreshold * 2) {
				return false
			}

			// Check specific position combinations for overlap.
			// Same position for nearby points definitely overlaps.
			if (p1.position === p2.position && costDiff < horizontalThreshold && scoreDiff < verticalThreshold) {
				return true
			}

			// Check adjacent position overlaps.
			const p1IsTop = p1.position === "top"
			const p1IsBottom = p1.position === "bottom"
			const p2IsTop = p2.position === "top"
			const p2IsBottom = p2.position === "bottom"

			// If both labels are on the same vertical side and points are close
			// horizontally.
			if ((p1IsTop && p2IsTop) || (p1IsBottom && p2IsBottom)) {
				if (costDiff < horizontalThreshold && scoreDiff < verticalThreshold / 2) {
					return true
				}
			}

			return false
		}

		// Helper function to check if position would overlap with a data point.
		const wouldOverlapPoint = (point: (typeof chartData)[0], position: LabelPosition): boolean => {
			for (const other of chartData) {
				if (other.label === point.label) {
					continue
				}

				const costDiff = Math.abs(point.cost - other.cost)
				const scoreDiff = Math.abs(point.score - other.score)

				// Check if label would be placed on top of another point.
				switch (position) {
					case "top":
						// Label is above, check if there's a point above.
						if (costDiff < 3 && other.score > point.score && other.score - point.score < 6) {
							return true
						}
						break
					case "bottom":
						// Label is below, check if there's a point below.
						if (costDiff < 3 && other.score < point.score && point.score - other.score < 6) {
							return true
						}
						break
					case "left":
						// Label is to the left, check if there's a point to the left.
						if (scoreDiff < 3 && other.cost < point.cost && point.cost - other.cost < 4) {
							return true
						}
						break
					case "right":
						// Label is to the right, check if there's a point to the right.
						if (scoreDiff < 3 && other.cost > point.cost && other.cost - point.cost < 4) {
							return true
						}
						break
				}
			}
			return false
		}

		// Sort points to process them in a consistent order.
		// Process from top-left to bottom-right.
		const sortedData = [...chartData].sort((a, b) => {
			// First by score (higher first).
			const scoreDiff = b.score - a.score
			if (Math.abs(scoreDiff) > 1) return scoreDiff
			// Then by cost (lower first).
			return a.cost - b.cost
		})

		// Process each point and find the best position.
		sortedData.forEach((point) => {
			// Try positions in order of preference.
			const positionPreferences: LabelPosition[] = ["top", "bottom", "right", "left"]

			let bestPosition: LabelPosition = "top"

			for (const position of positionPreferences) {
				// Check if this position would overlap with any placed labels.
				let hasLabelOverlap = false

				for (const placed of placedLabels) {
					if (
						wouldLabelsOverlap(
							{ cost: point.cost, score: point.score, position },
							{ cost: placed.cost, score: placed.score, position: placed.position },
						)
					) {
						hasLabelOverlap = true
						break
					}
				}

				// Check if this position would overlap with any data points.
				const hasPointOverlap = wouldOverlapPoint(point, position)

				// If no overlaps, use this position.
				if (!hasLabelOverlap && !hasPointOverlap) {
					bestPosition = position
					break
				}
			}

			// Use the best position found
			positions[point.label] = bestPosition
			placedLabels.push({
				cost: point.cost,
				score: point.score,
				label: point.label,
				position: bestPosition,
			})
		})

		return positions
	}, [chartData])

	return (
		<>
			<div className="pt-4 pb-8 font-mono">Cost x Score</div>
			<ChartContainer config={chartConfig} className="h-[500px] w-full">
				<ScatterChart margin={{ top: 20, right: 0, bottom: 0, left: 20 }}>
					<XAxis
						type="number"
						dataKey="cost"
						name="Cost"
						domain={[
							(dataMin: number) => Math.max(0, Math.round((dataMin - 5) / 5) * 5),
							(dataMax: number) => Math.round((dataMax + 5) / 5) * 5,
						]}
						tickFormatter={(value) => formatCurrency(value)}
					/>
					<YAxis
						type="number"
						dataKey="score"
						name="Score"
						domain={[
							(dataMin: number) => Math.max(0, Math.round((dataMin - 5) / 5) * 5),
							(dataMax: number) => Math.min(100, Math.round((dataMax + 5) / 5) * 5),
						]}
						tickFormatter={(value) => `${value}%`}
					/>
					<ChartTooltip
						content={({ active, payload }) => {
							if (!active || !payload || !payload.length || !payload[0]) {
								return null
							}

							const { label, cost, score } = payload[0].payload

							return (
								<div className="bg-background border rounded-sm p-2 shadow-sm text-left">
									<div className="border-b pb-1">{label}</div>
									<div className="pt-1">
										<div>
											Score: <span className="font-mono">{Math.round(score)}%</span>
										</div>
										<div>
											Cost: <span className="font-mono">{formatCurrency(cost)}</span>
										</div>
									</div>
								</div>
							)
						}}
					/>
					<Customized component={renderQuadrant} />
					{chartData.map((d, index) => (
						<Scatter
							key={d.label}
							name={d.label}
							data={[d]}
							fill={generateSpectrumColor(index, chartData.length)}>
							<LabelList
								dataKey="label"
								content={(props) => renderCustomLabel(props, labelPositions[d.label] || "top")}
							/>
						</Scatter>
					))}
				</ScatterChart>
			</ChartContainer>
			<div className="py-4 text-xs opacity-50">
				(Note: Models with a cost of $50 or more are excluded from the scatter plot.)
			</div>
		</>
	)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderQuadrant = (props: any) => (
	<Cross
		width={props.width}
		height={props.height}
		x={props.width / 2 + 35}
		y={props.height / 2 - 15}
		top={0}
		left={0}
		stroke="currentColor"
		opacity={0.1}
	/>
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderCustomLabel = (props: any, position: LabelPosition) => {
	const { x, y, value } = props
	const maxWidth = 80 // Maximum width in pixels - adjust as needed.

	const truncateText = (text: string, maxChars: number = 20) => {
		if (text.length <= maxChars) {
			return text
		}

		return text.substring(0, maxChars - 1) + "…"
	}

	// Calculate position offsets based on label position.
	let xOffset = 0
	let yOffset = 0
	let textAnchor: "middle" | "start" | "end" = "middle"
	let dominantBaseline: "auto" | "hanging" | "middle" = "auto"

	switch (position) {
		case "top":
			yOffset = -8
			textAnchor = "middle"
			dominantBaseline = "auto"
			break
		case "bottom":
			yOffset = 15
			textAnchor = "middle"
			dominantBaseline = "hanging"
			break
		case "left":
			xOffset = -8
			yOffset = 5
			textAnchor = "end"
			dominantBaseline = "middle"
			break
		case "right":
			xOffset = 15
			yOffset = 5
			textAnchor = "start"
			dominantBaseline = "middle"
			break
	}

	return (
		<text
			x={x + xOffset}
			y={y + yOffset}
			fontSize="11"
			fontWeight="500"
			fill="currentColor"
			opacity="0.8"
			textAnchor={textAnchor}
			dominantBaseline={dominantBaseline}
			style={{
				pointerEvents: "none",
				maxWidth: `${maxWidth}px`,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
			}}>
			{truncateText(value)}
		</text>
	)
}

const generateSpectrumColor = (index: number, total: number): string => {
	// Distribute hues evenly across the color wheel (0-360 degrees).
	// Start at 0 (red) and distribute evenly.
	const hue = (index * 360) / total

	// Use high saturation for vibrant colors.
	const saturation = 70

	// Use medium lightness for good visibility on both light and dark backgrounds.
	const lightness = 50

	return `hsl(${Math.round(hue)}, ${saturation}%, ${lightness}%)`
}
