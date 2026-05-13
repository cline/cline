/**
 * Highlighted input component for CLI
 * Renders text with @ mentions, / commands, and paste placeholders highlighted,
 * plus a movable cursor. For long multi-line input, only a viewport window of
 * lines is rendered, centered on the cursor position, with scroll indicators.
 */

import { mentionRegexGlobal } from "@shared/context-mentions"
import { Box, Text } from "ink"
import React from "react"

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_LINES = 10
const SLASH_COMMAND_REGEX = /(^|\s)(\/[a-zA-Z0-9_.-]+)/g
const PASTE_PLACEHOLDER_REGEX = /▸ \d+ lines? pasted #\d+/g
const PLACEHOLDER_HINT = " (space to expand...)"

// ── Types ──────────────────────────────────────────────────────────────────────

interface HighlightedInputProps {
	text: string
	cursorPos?: number
	availableCommands?: string[]
	/** Max visible lines before viewport windowing kicks in. Defaults to 10. */
	maxLines?: number
}

type SegmentType = "normal" | "mention" | "command" | "placeholder"

interface Segment {
	text: string
	type: SegmentType
	startIndex: number
}

interface Highlight {
	start: number
	end: number
	type: "mention" | "command" | "placeholder"
}

interface ViewportInfo {
	viewportText: string
	adjustedCursorPos: number
	linesAbove: number
	linesBelow: number
}

// ── Viewport Windowing ─────────────────────────────────────────────────────────

function calculateVisualLineCounts(lines: string[], contentWidth: number): number[] {
	return lines.map((line) => Math.max(1, Math.ceil(line.length / contentWidth)))
}

function findCursorLine(lines: string[], cursorPos: number): number {
	let charCount = 0
	for (let i = 0; i < lines.length; i++) {
		if (cursorPos <= charCount + lines[i].length) return i
		charCount += lines[i].length + 1
	}
	return lines.length - 1
}

function calculateCharOffset(lines: string[], upToLineIndex: number): number {
	let offset = 0
	for (let i = 0; i < upToLineIndex; i++) {
		offset += lines[i].length + 1
	}
	return offset
}

/**
 * Greedily expand a viewport window around the cursor line to fill a visual line budget.
 * Expands below first, then above with any remaining budget.
 */
function expandViewportWindow(
	cursorLine: number,
	visualCounts: number[],
	maxLines: number,
	totalLines: number,
): [start: number, end: number] {
	let viewStart = cursorLine
	let viewEnd = cursorLine + 1
	let budget = maxLines - visualCounts[cursorLine]

	for (let i = viewEnd; i < totalLines && budget > 0; i++) {
		if (visualCounts[i] > budget) break
		budget -= visualCounts[i]
		viewEnd = i + 1
	}
	for (let i = viewStart - 1; i >= 0 && budget > 0; i--) {
		if (visualCounts[i] > budget) break
		budget -= visualCounts[i]
		viewStart = i
	}

	return [viewStart, viewEnd]
}

/**
 * Compute a viewport window of `maxLines` visual lines centered on the cursor.
 * Returns null if the entire text fits without windowing.
 */
function computeViewport(text: string, cursorPos: number, maxLines: number): ViewportInfo | null {
	const lines = text.split(/\r?\n|\r/)
	const contentWidth = Math.max(1, (process.stdout.columns || 80) - 4)
	const visualCounts = calculateVisualLineCounts(lines, contentWidth)
	const totalVisualLines = visualCounts.reduce((sum, c) => sum + c, 0)

	if (totalVisualLines <= maxLines) return null

	const cursorLine = findCursorLine(lines, cursorPos)

	// First pass: reserve space for both scroll indicators (worst case)
	let [viewStart, viewEnd] = expandViewportWindow(cursorLine, visualCounts, maxLines - 2, lines.length)

	// Second pass: reclaim space if fewer indicators are actually needed
	const indicatorCount = (viewStart > 0 ? 1 : 0) + (viewEnd < lines.length ? 1 : 0)
	if (indicatorCount < 2) {
		;[viewStart, viewEnd] = expandViewportWindow(cursorLine, visualCounts, maxLines - indicatorCount, lines.length)
	}

	return {
		viewportText: lines.slice(viewStart, viewEnd).join("\n"),
		adjustedCursorPos: cursorPos - calculateCharOffset(lines, viewStart),
		linesAbove: viewStart,
		linesBelow: lines.length - viewEnd,
	}
}

// ── Highlight Detection ────────────────────────────────────────────────────────

function findAllMatches(regex: RegExp, text: string, type: Highlight["type"]): Highlight[] {
	regex.lastIndex = 0
	const results: Highlight[] = []
	let match
	while ((match = regex.exec(text)) !== null) {
		results.push({ start: match.index, end: match.index + match[0].length, type })
	}
	return results
}

function findSlashCommand(text: string, availableCommands?: string[]): Highlight | null {
	SLASH_COMMAND_REGEX.lastIndex = 0
	const match = SLASH_COMMAND_REGEX.exec(text)
	if (!match) return null

	const prefix = match[1] || ""
	const commandName = match[2].slice(1) // strip leading /

	if (availableCommands && !availableCommands.includes(commandName)) return null

	const start = match.index + prefix.length
	return { start, end: start + match[2].length, type: "command" }
}

/**
 * Parse text into segments with highlighted regions (mentions, commands, placeholders)
 * and normal text filling the gaps.
 */
function parseInput(text: string, availableCommands?: string[]): Segment[] {
	const highlights: Highlight[] = [
		...findAllMatches(mentionRegexGlobal, text, "mention"),
		...findAllMatches(PASTE_PLACEHOLDER_REGEX, text, "placeholder"),
	]

	const slashCmd = findSlashCommand(text, availableCommands)
	if (slashCmd) highlights.push(slashCmd)

	highlights.sort((a, b) => a.start - b.start)

	if (highlights.length === 0) {
		return [{ text, type: "normal", startIndex: 0 }]
	}

	const segments: Segment[] = []
	let cursor = 0

	for (const h of highlights) {
		if (h.start < cursor) continue // skip overlapping
		if (h.start > cursor) {
			segments.push({ text: text.slice(cursor, h.start), type: "normal", startIndex: cursor })
		}
		segments.push({ text: text.slice(h.start, h.end), type: h.type, startIndex: h.start })
		cursor = h.end
	}

	if (cursor < text.length) {
		segments.push({ text: text.slice(cursor), type: "normal", startIndex: cursor })
	}

	return segments
}

// ── Segment Rendering ──────────────────────────────────────────────────────────

function renderSegment(segment: Segment, key: number): React.ReactElement {
	if (segment.type === "placeholder") {
		// Strip the internal #N ID from the displayed text
		const displayText = segment.text.replace(/ #\d+$/, "")
		return (
			<Text bold key={key} underline>
				{displayText}
				{PLACEHOLDER_HINT}
			</Text>
		)
	}

	if (segment.type === "mention" || segment.type === "command") {
		return (
			<Text backgroundColor="gray" key={key}>
				{segment.text}
			</Text>
		)
	}

	return <Text key={key}>{segment.text}</Text>
}

function cursorInSegment(cursorPos: number, segment: Segment): boolean {
	return cursorPos >= segment.startIndex && cursorPos < segment.startIndex + segment.text.length
}

function renderSegmentWithCursor(segment: Segment, cursorPos: number, key: number): React.ReactElement {
	const { type, text: segText, startIndex } = segment
	const isPlaceholder = type === "placeholder"
	const isHighlighted = type === "mention" || type === "command"
	const localPos = cursorPos - startIndex

	const before = segText.slice(0, localPos)
	const char = segText[localPos]
	const after = segText.slice(localPos + 1)
	const onNewline = char === "\n"

	// Wrapper applies segment-specific styling to non-cursor text
	const Wrap = isPlaceholder
		? ({ children }: { children: React.ReactNode }) => (
				<Text bold underline>
					{children}
				</Text>
			)
		: isHighlighted
			? ({ children }: { children: React.ReactNode }) => <Text backgroundColor="gray">{children}</Text>
			: React.Fragment

	return (
		<Text key={key}>
			{before && <Wrap>{before}</Wrap>}
			<Text backgroundColor={isHighlighted ? "gray" : undefined} inverse>
				{onNewline ? " " : char}
			</Text>
			{onNewline && "\n"}
			{after && <Wrap>{after}</Wrap>}
			{isPlaceholder && (
				<Text bold underline>
					{PLACEHOLDER_HINT}
				</Text>
			)}
		</Text>
	)
}

// ── Main Render Logic ──────────────────────────────────────────────────────────

function renderHighlightedText(text: string, cursorPos: number | undefined, availableCommands?: string[]): React.ReactElement {
	if (cursorPos === undefined) {
		if (!text) return <Text />
		return <Text>{parseInput(text, availableCommands).map(renderSegment)}</Text>
	}

	const segments = parseInput(text, availableCommands)
	const safePos = Math.min(Math.max(0, cursorPos), text.length)

	return (
		<Text>
			{segments.map((seg, i) =>
				cursorInSegment(safePos, seg) ? renderSegmentWithCursor(seg, safePos, i) : renderSegment(seg, i),
			)}
			{safePos >= text.length && <Text inverse> </Text>}
		</Text>
	)
}

// ── Component ──────────────────────────────────────────────────────────────────

export const HighlightedInput: React.FC<HighlightedInputProps> = ({
	text,
	cursorPos,
	availableCommands,
	maxLines = DEFAULT_MAX_LINES,
}) => {
	const viewport = cursorPos !== undefined ? computeViewport(text, cursorPos, maxLines) : null

	if (!viewport) {
		return (
			<Box flexDirection="column" width="100%">
				{renderHighlightedText(text, cursorPos, availableCommands)}
			</Box>
		)
	}

	return (
		<Box flexDirection="column" width="100%">
			{viewport.linesAbove > 0 && (
				<Text color="gray">
					↑ {viewport.linesAbove} more {viewport.linesAbove === 1 ? "line" : "lines"}
				</Text>
			)}
			{renderHighlightedText(viewport.viewportText, viewport.adjustedCursorPos, availableCommands)}
			{viewport.linesBelow > 0 && (
				<Text color="gray">
					↓ {viewport.linesBelow} more {viewport.linesBelow === 1 ? "line" : "lines"}
				</Text>
			)}
		</Box>
	)
}
