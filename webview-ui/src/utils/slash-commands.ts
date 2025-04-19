export interface SlashCommand {
	name: string
	description: string
}

export const SUPPORTED_SLASH_COMMANDS: SlashCommand[] = [
	{
		name: "newtask",
		description: "Create a new task with context from the current task",
	},
]

// Regex for detecting slash commands in text
export const slashCommandRegex = /\/([a-zA-Z0-9_-]+)(\s|$)/
export const slashCommandRegexGlobal = new RegExp(slashCommandRegex.source, "g")

/**
 * Determines whether the slash command menu should be displayed based on text input
 */
export function shouldShowSlashCommandsMenu(text: string, cursorPosition: number): boolean {
	const beforeCursor = text.slice(0, cursorPosition)

	// first check if there is a slash before the cursor
	const slashIndex = beforeCursor.lastIndexOf("/")

	if (slashIndex === -1) {
		return false
	}

	// check if slash is at the very beginning (with optional whitespace)
	const textBeforeSlash = beforeCursor.slice(0, slashIndex)
	if (!/^\s*$/.test(textBeforeSlash)) {
		return false
	}

	// potential partial or full command
	const textAfterSlash = beforeCursor.slice(slashIndex + 1)

	// don't show menu if there's whitespace after the slash but before the cursor
	if (/\s/.test(textAfterSlash)) {
		return false
	}

	return true
}

/**
 * Gets filtered slash commands that match the current input
 */
export function getMatchingSlashCommands(query: string): SlashCommand[] {
	if (!query) {
		return [...SUPPORTED_SLASH_COMMANDS]
	}

	// filter commands that start with the query (case sensitive)
	return SUPPORTED_SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(query))
}

/**
 * Insert a slash command at position or replace partial command
 */
export function insertSlashCommand(text: string, commandName: string): { newValue: string; commandIndex: number } {
	const slashIndex = text.indexOf("/")

	// where the command ends, at the end of entire text or first space
	const commandEndIndex = text.indexOf(" ", slashIndex)

	// replace the partial command with the full command
	const newValue =
		text.substring(0, slashIndex + 1) + commandName + (commandEndIndex > -1 ? text.substring(commandEndIndex) : " ") // add extra space at the end if only slash command

	return { newValue, commandIndex: slashIndex }
}

/**
 * Determines the validation state of a slash command
 * Returns partial if we have a partial match against valid commands, or full for full match
 */
export function validateSlashCommand(command: string): "full" | "partial" | null {
	if (!command) {
		return null
	}

	// case sensitive matching
	const exactMatch = SUPPORTED_SLASH_COMMANDS.some((cmd) => cmd.name === command)

	if (exactMatch) {
		return "full"
	}

	const partialMatch = SUPPORTED_SLASH_COMMANDS.some((cmd) => cmd.name.startsWith(command))

	if (partialMatch) {
		return "partial"
	}

	return null // no match
}
