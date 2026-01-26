/**
 * Highlighted input component for CLI
 * Renders text with @ mentions and / commands highlighted
 */

import { mentionRegexGlobal } from "@shared/context-mentions"
import { Text } from "ink"
import React from "react"

interface HighlightedInputProps {
	text: string
	availableCommands?: string[]
}

// Regex for / commands (at start or after whitespace)
const slashCommandRegex = /(^|\s)(\/[a-zA-Z0-9_.-]+)/g

interface Segment {
	text: string
	type: "normal" | "mention" | "command"
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
			})
		}

		// Add highlighted segment
		segments.push({
			text: text.slice(highlight.start, highlight.end),
			type: highlight.type,
		})

		lastIndex = highlight.end
	}

	// Add remaining text
	if (lastIndex < text.length) {
		segments.push({
			text: text.slice(lastIndex),
			type: "normal",
		})
	}

	return segments
}

export const HighlightedInput: React.FC<HighlightedInputProps> = ({ text, availableCommands }) => {
	if (!text) {
		return null
	}

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
