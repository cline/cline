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
 * Calculate how many visual lines each logical line takes up when wrapped.
 */
function calculateVisualLineCounts(lines: string[], contentWidth: number): number[] {
	return lines.map((line) => Math.max(1, Math.ceil(line.length / contentWidth)))
}

/**
 * Find which logical line contains the cursor position.
 */
function findCursorLine(lines: string[], cursorPos: number): number {
	let charCount = 0
	for (let i = 0; i < lines.length; i++) {
		if (cursorPos <= charCount + lines[i].length) {
			return i
		}
		charCount += lines[i].length + 1 // +1 for newline
	}
	return lines.length - 1
}

/**
 * Calculate character offset from start of text to start of a given line.
 */
function calculateCharOffset(lines: string[], upToLineIndex: number): number {
	let offset = 0
	for (let i = 0; i < upToLineIndex; i++) {
		offset += lines[i].length + 1 // +1 for newline
	}
	return offset
}

/**
 * Expand viewport window above and below cursor line to fill visual line budget.
 * Returns [startLine, endLine] inclusive range.
 */
function expandViewportWindow(
	cursorLine: number,
	visualCounts: number[],
	maxLines: number,
	totalLines: number,
): [number, number] {
	let viewStart = cursorLine
	let viewEnd = cursorLine + 1 // End is exclusive
	let visualBudget = maxLines - visualCounts[cursorLine]

	while (visualBudget > 0 && (viewStart > 0 || viewEnd < totalLines)) {
		const canAddAbove = viewStart > 0 && visualCounts[viewStart - 1] <= visualBudget
		const canAddBelow = viewEnd < totalLines && visualCounts[viewEnd] <= visualBudget

		// Prefer keeping cursor centered when both directions available
		const distanceFromCursor = {
			above: cursorLine - viewStart,
			below: viewEnd - cursorLine,
		}

		if (canAddAbove && (!canAddBelow || distanceFromCursor.above < distanceFromCursor.below)) {
			visualBudget -= visualCounts[--viewStart]
		} else if (canAddBelow) {
			visualBudget -= visualCounts[viewEnd++]
		} else {
			break
		}
	}

	return [viewStart, viewEnd]
}

/**
 * Given multi-line text and a cursor position, compute a viewport window
 * of `maxLines` visual lines centered on the cursor. Returns null if no windowing needed.
 * Accounts for text wrapping: long logical lines count as multiple visual lines.
 */
function computeViewport(text: string, cursorPos: number, maxLines: number): ViewportInfo | null {
	const lines = text.split(/\r?\n|\r/)
	const terminalWidth = process.stdout.columns || 80
	const contentWidth = Math.max(1, terminalWidth - 4) // Border + padding

	const visualCounts = calculateVisualLineCounts(lines, contentWidth)
	const totalVisualLines = visualCounts.reduce((sum, count) => sum + count, 0)

	// No viewport needed if everything fits
	if (totalVisualLines <= maxLines) return null

	const cursorLine = findCursorLine(lines, cursorPos)
	const [viewStart, viewEnd] = expandViewportWindow(cursorLine, visualCounts, maxLines, lines.length)
	const startCharOffset = calculateCharOffset(lines, viewStart)

	return {
		viewportText: lines.slice(viewStart, viewEnd).join("\n"),
		adjustedCursorPos: cursorPos - startCharOffset,
		linesAbove: viewStart,
		linesBelow: lines.length - viewEnd,
		totalLines: lines.length,
	}
}

type Highlight = { start: number; end: number; type: "mention" | "command" }

/**
 * Find all @mentions in the text.
 */
function findMentions(text: string): Highlight[] {
	const mentions: Highlight[] = []
	mentionRegexGlobal.lastIndex = 0
	let match
	while ((match = mentionRegexGlobal.exec(text)) !== null) {
		mentions.push({
			start: match.index,
			end: match.index + match[0].length,
			type: "mention",
		})
	}
	return mentions
}

/**
 * Find the first valid slash command in the text.
 */
function findSlashCommand(text: string, availableCommands?: string[]): Highlight | null {
	slashCommandRegex.lastIndex = 0
	const match = slashCommandRegex.exec(text)
	if (!match) return null

	const prefix = match[1] || ""
	const commandText = match[2] // e.g., "/help"
	const commandName = commandText.slice(1) // e.g., "help"

	// Only highlight if command is valid
	if (availableCommands && !availableCommands.includes(commandName)) {
		return null
	}

	return {
		start: match.index + prefix.length,
		end: match.index + prefix.length + commandText.length,
		type: "command",
	}
}

/**
 * Build text segments from highlights, filling gaps with normal text.
 */
function buildSegments(text: string, highlights: Highlight[]): Segment[] {
	if (highlights.length === 0) {
		return [{ text, type: "normal", startIndex: 0 }]
	}

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

	return segments
}

/**
 * Parse text into segments with @mentions and /commands highlighted.
 */
function parseInput(text: string, availableCommands?: string[]): Segment[] {
	const highlights: Highlight[] = [
		...findMentions(text),
		...(findSlashCommand(text, availableCommands) ? [findSlashCommand(text, availableCommands)!] : []),
	]

	// Sort by start position
	highlights.sort((a, b) => a.start - b.start)

	return buildSegments(text, highlights)
}

/**
 * Render a text segment without cursor (just highlighting if needed).
 */
function renderSegment(segment: Segment, key: number): React.ReactElement {
	const isHighlighted = segment.type === "mention" || segment.type === "command"
	return isHighlighted ? (
		<Text backgroundColor="gray" key={key}>
			{segment.text}
		</Text>
	) : (
		<Text key={key}>{segment.text}</Text>
	)
}

/**
 * Check if cursor is within a segment's bounds.
 */
function cursorInSegment(cursorPos: number, segment: Segment): boolean {
	const segmentEnd = segment.startIndex + segment.text.length
	return cursorPos >= segment.startIndex && cursorPos < segmentEnd
}

/**
 * Render a segment with the cursor inside it.
 */
function renderSegmentWithCursor(segment: Segment, cursorPos: number, key: number): React.ReactElement {
	const isHighlighted = segment.type === "mention" || segment.type === "command"
	const localCursorPos = cursorPos - segment.startIndex

	const beforeCursor = segment.text.slice(0, localCursorPos)
	const cursorChar = segment.text[localCursorPos]
	const afterCursor = segment.text.slice(localCursorPos + 1)

	// When cursor is on a newline, show a visible cursor block followed by the newline
	const cursorOnNewline = cursorChar === "\n"
	const displayCursor = cursorOnNewline ? " " : cursorChar

	const TextWrapper = isHighlighted
		? ({ children }: { children: React.ReactNode }) => <Text backgroundColor="gray">{children}</Text>
		: React.Fragment

	return (
		<Text key={key}>
			{beforeCursor && <TextWrapper>{beforeCursor}</TextWrapper>}
			<Text backgroundColor={isHighlighted ? "gray" : undefined} inverse>
				{displayCursor}
			</Text>
			{cursorOnNewline && "\n"}
			{afterCursor && <TextWrapper>{afterCursor}</TextWrapper>}
		</Text>
	)
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
	// No cursor - just render highlighted segments (or empty)
	if (displayCursorPos === undefined) {
		if (!displayText) return <Text />
		const segments = parseInput(displayText, availableCommands)
		return <Text>{segments.map((segment, idx) => renderSegment(segment, idx))}</Text>
	}

	// With cursor - always show cursor even for empty text
	const segments = parseInput(displayText, availableCommands)
	const safeCursorPos = Math.min(Math.max(0, displayCursorPos), displayText.length)
	const cursorAtEnd = safeCursorPos >= displayText.length

	return (
		<Text>
			{segments.map((segment, idx) =>
				cursorInSegment(safeCursorPos, segment)
					? renderSegmentWithCursor(segment, safeCursorPos, idx)
					: renderSegment(segment, idx),
			)}
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
