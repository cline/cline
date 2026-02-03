/**
 * Highlighted input component for CLI
 * Renders text with @ mentions and / commands highlighted, plus a movable cursor
 */

import { mentionRegexGlobal } from "@shared/context-mentions"
import { Text } from "ink"
import React from "react"

interface HighlightedInputProps {
	text: string
	cursorPos?: number
	availableCommands?: string[]
}

// Regex for / commands (at start or after whitespace)
const slashCommandRegex = /(^|\s)(\/[a-zA-Z0-9_.-]+)/g

interface Segment {
	text: string
	type: "normal" | "mention" | "command"
	startIndex: number
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

export const HighlightedInput: React.FC<HighlightedInputProps> = ({ text, cursorPos, availableCommands }) => {
	// If no cursor position provided, just render text with highlights (backward compatible)
	if (cursorPos === undefined) {
		if (!text) return null
		const segments = parseInput(text, availableCommands)
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
	const safeCursorPos = Math.min(Math.max(0, cursorPos), text.length)
	const segments = parseInput(text, availableCommands)

	// Render segments with cursor
	const renderSegmentWithCursor = (segment: Segment, segmentIdx: number) => {
		const segmentStart = segment.startIndex
		const segmentEnd = segmentStart + segment.text.length
		const isHighlighted = segment.type === "mention" || segment.type === "command"

		// Check if cursor is within this segment
		if (safeCursorPos >= segmentStart && safeCursorPos < segmentEnd) {
			// Cursor is in this segment - split it
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

		// Cursor not in this segment - render normally
		if (isHighlighted) {
			return (
				<Text backgroundColor="gray" key={segmentIdx}>
					{segment.text}
				</Text>
			)
		}
		return <Text key={segmentIdx}>{segment.text}</Text>
	}

	// Check if cursor is at the end (past all text)
	const cursorAtEnd = safeCursorPos >= text.length

	return (
		<Text>
			{segments.map((segment, idx) => renderSegmentWithCursor(segment, idx))}
			{cursorAtEnd && <Text inverse> </Text>}
		</Text>
	)
}
