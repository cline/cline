/**
 * Highlighted input component for CLI
 * Renders text with @ mentions and / commands highlighted, plus a movable cursor.
 * For long multi-line input (e.g. large pastes), only a viewport window of lines
 * is rendered, centered on the cursor position, with scroll indicators.
 */

import { mentionRegexGlobal } from "@shared/context-mentions"
import { Box, Text } from "ink"
import React from "react"

interface HighlightedInputProps {
	text: string
	cursorPos?: number
	availableCommands?: string[]
	/** Max visible lines before viewport windowing kicks in. Defaults to 10. */
	maxLines?: number
}

const DEFAULT_MAX_LINES = 10

// Regex for / commands (at start or after whitespace)
const slashCommandRegex = /(^|\s)(\/[a-zA-Z0-9_.-]+)/g

interface Segment {
	text: string
	type: "normal" | "mention" | "command"
	startIndex: number
}

interface ViewportInfo {
	/** The visible slice of text to render */
	viewportText: string
	/** Cursor position relative to viewportText */
	adjustedCursorPos: number
	/** Number of lines hidden above the viewport */
	linesAbove: number
	/** Number of lines hidden below the viewport */
	linesBelow: number
	/** Total line count of the full text */
	totalLines: number
}

/**
 * Given multi-line text and a cursor position, compute a viewport window
 * of `maxLines` lines centered on the cursor. Returns null if no windowing needed.
 */
function computeViewport(text: string, cursorPos: number, maxLines: number): ViewportInfo | null {
	const lines = text.split(/\r?\n|\r/)
	if (lines.length <= maxLines) return null

	// Find which line the cursor is on
	let charCount = 0
	let cursorLine = lines.length - 1 // fallback to last line
	for (let i = 0; i < lines.length; i++) {
		if (cursorPos <= charCount + lines[i].length) {
			cursorLine = i
			break
		}
		charCount += lines[i].length + 1 // +1 for \n
	}

	// Position viewport with padding so cursor doesn't sit at the edge
	const padding = Math.max(2, Math.floor(maxLines / 4))
	let viewStart = cursorLine - (maxLines - padding - 1)
	viewStart = Math.max(0, Math.min(viewStart, cursorLine - padding))
	let viewEnd = viewStart + maxLines

	// Clamp to bounds
	if (viewEnd > lines.length) {
		viewEnd = lines.length
		viewStart = Math.max(0, viewEnd - maxLines)
	}

	// Calculate character offset where the viewport starts
	let startCharOffset = 0
	for (let i = 0; i < viewStart; i++) {
		startCharOffset += lines[i].length + 1
	}

	return {
		viewportText: lines.slice(viewStart, viewEnd).join("\n"),
		adjustedCursorPos: cursorPos - startCharOffset,
		linesAbove: viewStart,
		linesBelow: lines.length - viewEnd,
		totalLines: lines.length,
	}
}

function parseInput(text: string, availableCommands?: string[]): Segment[] {
	const highlights: { start: number; end: number; type: "mention" | "command" }[] = []

	// Find all mentions
	mentionRegexGlobal.lastIndex = 0
	let match
	while ((match = mentionRegexGlobal.exec(text)) !== null) {
		highlights.push({
			start: match.index,
			end: match.index + match[0].length,
			type: "mention",
		})
	}

	// Find first slash command only (must be complete and valid)
	slashCommandRegex.lastIndex = 0
	const slashMatch = slashCommandRegex.exec(text)
	if (slashMatch) {
		const prefix = slashMatch[1] || ""
		const commandText = slashMatch[2] // e.g., "/help"
		const commandName = commandText.slice(1) // e.g., "help"
		const commandStart = slashMatch.index + prefix.length
		const commandEnd = commandStart + commandText.length

		// Only highlight if command exists in available commands (or if no list provided)
		if (!availableCommands || availableCommands.includes(commandName)) {
			highlights.push({
				start: commandStart,
				end: commandEnd,
				type: "command",
			})
		}
	}

	// Sort highlights by start position
	highlights.sort((a, b) => a.start - b.start)

	// Build segments
	const segments: Segment[] = []
	let lastIndex = 0

	for (const highlight of highlights) {
		// Skip overlapping highlights
		if (highlight.start < lastIndex) continue

		// Add normal text before this highlight
		if (highlight.start > lastIndex) {
			segments.push({
				text: text.slice(lastIndex, highlight.start),
				type: "normal",
				startIndex: lastIndex,
			})
		}

		// Add highlighted segment
		segments.push({
			text: text.slice(highlight.start, highlight.end),
			type: highlight.type,
			startIndex: highlight.start,
		})

		lastIndex = highlight.end
	}

	// Add remaining text
	if (lastIndex < text.length) {
		segments.push({
			text: text.slice(lastIndex),
			type: "normal",
			startIndex: lastIndex,
		})
	}

	// Always ensure at least one segment exists for stable cursor rendering
	if (segments.length === 0) {
		segments.push({
			text: text,
			type: "normal",
			startIndex: 0,
		})
	}

	return segments
}

/**
 * Renders the highlighted text content with cursor.
 * This is the core rendering logic, shared between viewport and non-viewport modes.
 */
function renderHighlightedText(
	displayText: string,
	displayCursorPos: number | undefined,
	availableCommands?: string[],
): React.ReactElement {
	// If no cursor position provided, just render text with highlights
	if (displayCursorPos === undefined) {
		if (!displayText) return <Text />
		const segments = parseInput(displayText, availableCommands)
		return (
			<Text>
				{segments.map((segment, idx) => {
					if (segment.type === "mention" || segment.type === "command") {
						return (
							<Text backgroundColor="gray" key={idx}>
								{segment.text}
							</Text>
						)
					}
					return <Text key={idx}>{segment.text}</Text>
				})}
			</Text>
		)
	}

	// With cursor position - render cursor within the text
	const safeCursorPos = Math.min(Math.max(0, displayCursorPos), displayText.length)
	const segments = parseInput(displayText, availableCommands)

	const renderSegmentWithCursor = (segment: Segment, segmentIdx: number) => {
		const segmentStart = segment.startIndex
		const segmentEnd = segmentStart + segment.text.length
		const isHighlighted = segment.type === "mention" || segment.type === "command"

		if (safeCursorPos >= segmentStart && safeCursorPos < segmentEnd) {
			const localCursorPos = safeCursorPos - segmentStart
			const beforeCursor = segment.text.slice(0, localCursorPos)
			const cursorChar = segment.text[localCursorPos]
			const afterCursor = segment.text.slice(localCursorPos + 1)

			if (isHighlighted) {
				return (
					<Text key={segmentIdx}>
						{beforeCursor && <Text backgroundColor="gray">{beforeCursor}</Text>}
						<Text backgroundColor="gray" inverse>
							{cursorChar}
						</Text>
						{afterCursor && <Text backgroundColor="gray">{afterCursor}</Text>}
					</Text>
				)
			}
			return (
				<Text key={segmentIdx}>
					{beforeCursor}
					<Text inverse>{cursorChar}</Text>
					{afterCursor}
				</Text>
			)
		}

		if (isHighlighted) {
			return (
				<Text backgroundColor="gray" key={segmentIdx}>
					{segment.text}
				</Text>
			)
		}
		return <Text key={segmentIdx}>{segment.text}</Text>
	}

	const cursorAtEnd = safeCursorPos >= displayText.length

	return (
		<Text>
			{segments.map((segment, idx) => renderSegmentWithCursor(segment, idx))}
			{cursorAtEnd && <Text inverse> </Text>}
		</Text>
	)
}

export const HighlightedInput: React.FC<HighlightedInputProps> = ({
	text,
	cursorPos,
	availableCommands,
	maxLines = DEFAULT_MAX_LINES,
}) => {
	// Check if viewport windowing is needed
	const viewport = cursorPos !== undefined ? computeViewport(text, cursorPos, maxLines) : null

	if (viewport) {
		const content = renderHighlightedText(viewport.viewportText, viewport.adjustedCursorPos, availableCommands)
		return (
			<Box flexDirection="column">
				{viewport.linesAbove > 0 && (
					<Text color="gray">
						↑ {viewport.linesAbove} more {viewport.linesAbove === 1 ? "line" : "lines"}
					</Text>
				)}
				{content}
				{viewport.linesBelow > 0 && (
					<Text color="gray">
						↓ {viewport.linesBelow} more {viewport.linesBelow === 1 ? "line" : "lines"}
					</Text>
				)}
			</Box>
		)
	}

	// No viewport needed — render normally
	return renderHighlightedText(text, cursorPos, availableCommands)
}
