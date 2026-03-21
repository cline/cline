import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"

const PRIMARY_LINE = "✨ NEW Orchestrate parallel agents on a kanban board ✨"
const SECONDARY_LINE = "cline --kanban"

function isCombiningMark(codePoint: number): boolean {
	return (
		(codePoint >= 0x0300 && codePoint <= 0x036f) ||
		(codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
		(codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
		(codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
		(codePoint >= 0xfe20 && codePoint <= 0xfe2f)
	)
}

function isWideCodePoint(codePoint: number): boolean {
	return (
		codePoint === 0x2728 ||
		(codePoint >= 0x1100 &&
			(codePoint <= 0x115f ||
				codePoint === 0x2329 ||
				codePoint === 0x232a ||
				(codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
				(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
				(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
				(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
				(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
				(codePoint >= 0xff00 && codePoint <= 0xff60) ||
				(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
				(codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
				(codePoint >= 0x1f680 && codePoint <= 0x1f6ff) ||
				(codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
				(codePoint >= 0x1fa70 && codePoint <= 0x1faff)))
	)
}

function getDisplayWidth(text: string): number {
	let width = 0
	for (const char of text) {
		const codePoint = char.codePointAt(0)
		if (!codePoint) {
			continue
		}
		if (isCombiningMark(codePoint) || codePoint === 0xfe0f) {
			continue
		}
		width += isWideCodePoint(codePoint) ? 2 : 1
	}
	return width
}

function centerLine(text: string): string {
	const width = process.stdout.columns || 80
	const padding = Math.max(0, Math.floor((width - getDisplayWidth(text)) / 2))
	return " ".repeat(padding)
}

export const KanbanBanner: React.FC = () => {
	const primaryPrefix = centerLine(PRIMARY_LINE)
	const secondaryPrefix = centerLine(SECONDARY_LINE)

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text>
				{primaryPrefix}
				<Text>✨ </Text>
				<Text backgroundColor="yellow" color="black">
					{" "}
					NEW{" "}
				</Text>
				<Text color="white"> Orchestrate parallel agents on a kanban board ✨</Text>
			</Text>
			<Text>
				{secondaryPrefix}
				<Text color={COLORS.primaryBlue}>cline --kanban</Text>
			</Text>
		</Box>
	)
}
