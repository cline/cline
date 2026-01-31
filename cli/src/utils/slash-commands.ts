/**
 * Slash command utilities for CLI
 * Handles detection, filtering, and insertion of slash commands
 */

import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { fuzzyFilter } from "./fuzzy-search"

export interface SlashQueryInfo {
	inSlashMode: boolean
	query: string
	slashIndex: number
}

export interface VisibleWindow<T> {
	items: T[]
	startIndex: number
}

/**
 * Calculate visible window for a scrollable list menu.
 * Centers the selected item in the visible window when possible.
 * Returns the visible items and the start index for selection tracking.
 */
export function getVisibleWindow<T>(items: T[], selectedIndex: number, maxVisible: number = 5): VisibleWindow<T> {
	if (items.length <= maxVisible) {
		return { items, startIndex: 0 }
	}

	const halfWindow = Math.floor(maxVisible / 2)
	let startIndex = Math.max(0, selectedIndex - halfWindow)
	const endIndex = Math.min(items.length, startIndex + maxVisible)

	// Adjust if we're near the end
	if (endIndex - startIndex < maxVisible) {
		startIndex = Math.max(0, endIndex - maxVisible)
	}

	return { items: items.slice(startIndex, endIndex), startIndex }
}

/**
 * Sort commands with workflows (custom section) first, then default commands.
 */
export function sortCommandsWorkflowsFirst(commands: SlashCommandInfo[]): SlashCommandInfo[] {
	return [...commands.filter((cmd) => cmd.section === "custom"), ...commands.filter((cmd) => cmd.section !== "custom")]
}

/**
 * Extract slash command query from input text.
 * Returns info about whether we're in slash mode and what the query is.
 * Takes cursor position to only examine text before cursor (matching webview behavior).
 */
export function extractSlashQuery(text: string, cursorPosition?: number): SlashQueryInfo {
	// Use text up to cursor position (or full text if no cursor position provided)
	const beforeCursor = cursorPosition !== undefined ? text.slice(0, cursorPosition) : text

	// Find the last slash before cursor
	const slashIndex = beforeCursor.lastIndexOf("/")

	if (slashIndex === -1) {
		return { inSlashMode: false, query: "", slashIndex: -1 }
	}

	// Slash must be at start or preceded by whitespace
	const charBeforeSlash = slashIndex > 0 ? beforeCursor[slashIndex - 1] : null
	if (charBeforeSlash !== null && !/\s/.test(charBeforeSlash)) {
		return { inSlashMode: false, query: "", slashIndex: -1 }
	}

	// Get text after slash (up to cursor)
	const textAfterSlash = beforeCursor.slice(slashIndex + 1)

	// If there's whitespace after slash, we're not in slash mode anymore
	if (/\s/.test(textAfterSlash)) {
		return { inSlashMode: false, query: "", slashIndex: -1 }
	}

	// Check if there's already a completed slash command earlier in the text
	// (only first slash command per message is processed)
	const firstSlashCommandRegex = /(^|\s)\/[a-zA-Z0-9_.-]+\s/
	const textBeforeCurrentSlash = text.slice(0, slashIndex)
	if (firstSlashCommandRegex.test(textBeforeCurrentSlash)) {
		return { inSlashMode: false, query: "", slashIndex: -1 }
	}

	return {
		inSlashMode: true,
		query: textAfterSlash,
		slashIndex,
	}
}

/**
 * Filter commands using fuzzy matching
 */
export function filterCommands(commands: SlashCommandInfo[], query: string): SlashCommandInfo[] {
	if (!query) {
		return commands
	}
	return fuzzyFilter(commands, query, (cmd) => cmd.name)
}

/**
 * Insert a slash command at the given slash index, replacing any partial query
 */
export function insertSlashCommand(text: string, slashIndex: number, commandName: string): string {
	const beforeSlash = text.slice(0, slashIndex)
	// Insert command with trailing space
	return `${beforeSlash}/${commandName} `
}
