/**
 * Slash command utilities for CLI
 * Handles detection, filtering, and insertion of slash commands
 */

import type { SlashCommandInfo } from "@shared/proto/cline/slash"

export interface SlashQueryInfo {
	inSlashMode: boolean
	query: string
	slashIndex: number
}

/**
 * Extract slash command query from input text.
 * Returns info about whether we're in slash mode and what the query is.
 */
export function extractSlashQuery(text: string): SlashQueryInfo {
	// Find the last slash in the text
	const slashIndex = text.lastIndexOf("/")

	if (slashIndex === -1) {
		return { inSlashMode: false, query: "", slashIndex: -1 }
	}

	// Slash must be at start or preceded by whitespace
	const charBeforeSlash = slashIndex > 0 ? text[slashIndex - 1] : null
	if (charBeforeSlash !== null && !/\s/.test(charBeforeSlash)) {
		return { inSlashMode: false, query: "", slashIndex: -1 }
	}

	// Get text after the slash
	const textAfterSlash = text.slice(slashIndex + 1)

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
 * Filter commands that match the query prefix (case-insensitive)
 */
export function filterCommands(commands: SlashCommandInfo[], query: string): SlashCommandInfo[] {
	if (!query) {
		return commands
	}
	return commands.filter((cmd) => cmd.name.toLowerCase().startsWith(query.toLowerCase()))
}

/**
 * Insert a slash command at the given slash index, replacing any partial query
 */
export function insertSlashCommand(text: string, slashIndex: number, commandName: string): string {
	const beforeSlash = text.slice(0, slashIndex)
	// Insert command with trailing space
	return `${beforeSlash}/${commandName} `
}
