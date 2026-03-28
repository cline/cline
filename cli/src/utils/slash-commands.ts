/**
 * Slash command utilities for CLI
 * Handles detection, filtering, and insertion of slash commands
 */

import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { CLI_ONLY_COMMANDS } from "@shared/slashCommands"
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

export interface StandaloneSlashCommandExecutionInput {
	prompt: string
	inSlashMode: boolean
	hasSlashMenu: boolean
	hasPendingAsk: boolean
	isSpinnerActive: boolean
}

export function createCliOnlySlashCommands(): SlashCommandInfo[] {
	return CLI_ONLY_COMMANDS.map((cmd) => ({
		name: cmd.name,
		description: cmd.description || "",
		section: cmd.section || "default",
		cliCompatible: true,
	}))
}

/**
 * Calculate visible window for a scrollable list menu.
 * Centers the selected item in the visible window when possible.
 * Returns the visible items and the start index for selection tracking.
 */
export function getVisibleWindow<T>(items: T[], selectedIndex: number, maxVisible = 5): VisibleWindow<T> {
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
 * Detect a standalone slash command (for example "/q" or "/exit")
 * that should be executed immediately when enter is pressed.
 */
export function getStandaloneSlashCommandName(text: string): string | null {
	const match = text.trim().match(/^\/([a-zA-Z0-9_.-]+)$/)
	return match?.[1] ?? null
}

/**
 * Resolve whether pressing Enter should execute a standalone CLI slash command.
 * This keeps ChatView's key handling deterministic and easy to test.
 */
export function getStandaloneSlashCommandToExecute({
	prompt,
	inSlashMode,
	hasSlashMenu,
	hasPendingAsk,
	isSpinnerActive,
}: StandaloneSlashCommandExecutionInput): string | null {
	const standaloneSlashCommand = getStandaloneSlashCommandName(prompt)
	if (!standaloneSlashCommand) {
		return null
	}

	if (hasPendingAsk || isSpinnerActive) {
		return null
	}

	if (inSlashMode && hasSlashMenu) {
		return null
	}

	return standaloneSlashCommand
}

/**
 * Filter commands using fuzzy matching
 */
export function filterCommands(commands: SlashCommandInfo[], query: string): SlashCommandInfo[] {
	if (!query) {
		return commands
	}

	const normalizedQuery = query.toLowerCase()
	const exactMatches: SlashCommandInfo[] = []
	const prefixMatches: SlashCommandInfo[] = []
	const remaining: SlashCommandInfo[] = []

	for (const command of commands) {
		const normalizedName = command.name.toLowerCase()
		if (normalizedName === normalizedQuery) {
			exactMatches.push(command)
			continue
		}
		if (normalizedName.startsWith(normalizedQuery)) {
			prefixMatches.push(command)
			continue
		}
		remaining.push(command)
	}

	return [...exactMatches, ...prefixMatches, ...fuzzyFilter(remaining, query, (cmd) => cmd.name)]
}

/**
 * Insert a slash command at the given slash index, replacing any partial query
 */
export function insertSlashCommand(text: string, slashIndex: number, commandName: string): string {
	const beforeSlash = text.slice(0, slashIndex)
	// Insert command with trailing space
	return `${beforeSlash}/${commandName} `
}
