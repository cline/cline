import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { BASE_SLASH_COMMANDS, type SlashCommand, VSCODE_ONLY_COMMANDS } from "../../../src/shared/slashCommands.ts"

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] =
	PLATFORM_CONFIG.type === PlatformType.VSCODE ? [...BASE_SLASH_COMMANDS, ...VSCODE_ONLY_COMMANDS] : BASE_SLASH_COMMANDS

export function getWorkflowCommands(
	localWorkflowToggles: Record<string, boolean>,
	globalWorkflowToggles: Record<string, boolean>,
	remoteWorkflowToggles?: Record<string, boolean>,
	remoteWorkflows?: any[],
): SlashCommand[] {
	const { workflows: localWorkflows, nameSet: localWorkflowNames } = Object.entries(localWorkflowToggles)
		.filter(([_, enabled]) => enabled)
		.reduce(
			(acc, [filePath, _]) => {
				const fileName = filePath.replace(/^.*[/\\]/, "")

				// Add to array of workflows
				acc.workflows.push({
					name: fileName,
					section: "custom",
				} as SlashCommand)

				// Add to set of names
				acc.nameSet.add(fileName)

				return acc
			},
			{ workflows: [] as SlashCommand[], nameSet: new Set<string>() },
		)

	const globalWorkflows = Object.entries(globalWorkflowToggles)
		.filter(([_, enabled]) => enabled)
		.flatMap(([filePath, _]) => {
			const fileName = filePath.replace(/^.*[/\\]/, "")

			// skip if a local workflow with the same name exists
			if (localWorkflowNames.has(fileName)) {
				return []
			}

			return [
				{
					name: fileName,
					section: "custom",
				},
			] as SlashCommand[]
		})

	// Add remote workflows that are enabled
	const remoteWorkflowCommands: SlashCommand[] = []
	if (remoteWorkflows && remoteWorkflowToggles) {
		for (const workflow of remoteWorkflows) {
			// Include if alwaysEnabled or if toggle is not explicitly false
			const enabled = workflow.alwaysEnabled || remoteWorkflowToggles[workflow.name] !== false
			if (enabled) {
				remoteWorkflowCommands.push({
					name: workflow.name,
					section: "custom",
				})
			}
		}
	}

	const workflows = [...localWorkflows, ...globalWorkflows, ...remoteWorkflowCommands]
	return workflows
}

// Regex for detecting slash commands in text
// Must be at start of string OR preceded by whitespace to avoid matching URLs/paths
// e.g., matches "/newtask" or "text /newtask" but not "http://example.com/newtask"
export const slashCommandRegex = /(^|\s)(\/[a-zA-Z0-9_.-]+)(?=\s|$)/
export const slashCommandRegexGlobal = new RegExp(slashCommandRegex.source, "g")
// Regex for detecting a slash command at the end of text (for deletion)
// Must be at start OR preceded by whitespace, captures the whole command including slash
export const slashCommandDeleteRegex = /(^|\s)(\/[a-zA-Z0-9_.-]+)$/

/**
 * Removes a slash command at the cursor position
 */
export function removeSlashCommand(text: string, position: number): { newText: string; newPosition: number } {
	const beforeCursor = text.slice(0, position)
	const afterCursor = text.slice(position)

	// Check if we're at the end of a slash command (anywhere in text, not just at start)
	const matchEnd = beforeCursor.match(slashCommandDeleteRegex)

	if (matchEnd) {
		// matchEnd[1] is the whitespace or empty string before the slash
		// matchEnd[2] is the slash command (e.g., "/newtask")
		const slashCommand = matchEnd[2]
		const newText = text.slice(0, position - slashCommand.length) + afterCursor.replace(" ", "") // removes the first space after the command
		const newPosition = position - slashCommand.length
		return { newText, newPosition }
	}

	// If we're not at the end of a slash command, just return the original text and position
	return { newText: text, newPosition: position }
}

/**
 * Determines whether the slash command menu should be displayed based on text input.
 * Only shows for the FIRST valid slash command position in the message - subsequent
 * slash commands won't trigger suggestions since only one is processed per message.
 */
export function shouldShowSlashCommandsMenu(text: string, cursorPosition: number): boolean {
	const beforeCursor = text.slice(0, cursorPosition)

	// first check if there is a slash before the cursor
	const slashIndex = beforeCursor.lastIndexOf("/")

	if (slashIndex === -1) {
		return false
	}

	// Check if slash is preceded by whitespace or is at the beginning
	// This allows slash commands anywhere in the message, similar to @ mentions
	const charBeforeSlash = slashIndex > 0 ? beforeCursor[slashIndex - 1] : null
	if (charBeforeSlash !== null && !/\s/.test(charBeforeSlash)) {
		return false
	}

	// potential partial or full command
	const textAfterSlash = beforeCursor.slice(slashIndex + 1)

	// don't show menu if there's whitespace after the slash but before the cursor
	if (/\s/.test(textAfterSlash)) {
		return false
	}

	// Only show suggestions for the FIRST slash command in the message.
	// Check if there's already a valid slash command earlier in the text.
	// A valid earlier slash command is one that: starts at beginning or after whitespace,
	// and is followed by whitespace (meaning it's complete).
	const firstSlashCommandRegex = /(^|\s)\/[a-zA-Z0-9_.-]+\s/
	const textBeforeCurrentSlash = text.slice(0, slashIndex)
	if (firstSlashCommandRegex.test(textBeforeCurrentSlash)) {
		return false
	}

	return true
}

/**
 * Gets filtered slash commands that match the current input
 */
export function getMatchingSlashCommands(
	query: string,
	localWorkflowToggles: Record<string, boolean> = {},
	globalWorkflowToggles: Record<string, boolean> = {},
	remoteWorkflowToggles?: Record<string, boolean>,
	remoteWorkflows?: any[],
): SlashCommand[] {
	const workflowCommands = getWorkflowCommands(
		localWorkflowToggles,
		globalWorkflowToggles,
		remoteWorkflowToggles,
		remoteWorkflows,
	)
	const allCommands = [...DEFAULT_SLASH_COMMANDS, ...workflowCommands]

	if (!query) {
		return allCommands
	}

	// filter commands that start with the query (case sensitive)
	return allCommands.filter((cmd) => cmd.name.startsWith(query))
}

/**
 * Insert a slash command at position or replace partial command
 */
export function insertSlashCommand(
	text: string,
	commandName: string,
	partialCommandLength: number,
	cursorPosition: number,
): { newValue: string; commandIndex: number } {
	// Find the slash nearest to cursor (before cursor position)
	const beforeCursor = text.slice(0, cursorPosition)
	const slashIndex = beforeCursor.lastIndexOf("/")

	const beforeSlash = text.substring(0, slashIndex + 1)
	const afterPartialCommand = text.substring(slashIndex + 1 + partialCommandLength)

	// replace the partial command with the full command
	const newValue =
		beforeSlash + commandName + (afterPartialCommand.startsWith(" ") ? afterPartialCommand : " " + afterPartialCommand)

	return { newValue, commandIndex: slashIndex }
}

/**
 * Determines the validation state of a slash command
 * Returns partial if we have a partial match against valid commands, or full for full match
 */
export function validateSlashCommand(
	command: string,
	localWorkflowToggles: Record<string, boolean> = {},
	globalWorkflowToggles: Record<string, boolean> = {},
	remoteWorkflowToggles?: Record<string, boolean>,
	remoteWorkflows?: any[],
): "full" | "partial" | null {
	if (!command) {
		return null
	}

	const workflowCommands = getWorkflowCommands(
		localWorkflowToggles,
		globalWorkflowToggles,
		remoteWorkflowToggles,
		remoteWorkflows,
	)
	const allCommands = [...DEFAULT_SLASH_COMMANDS, ...workflowCommands]

	// case sensitive matching
	const exactMatch = allCommands.some((cmd) => cmd.name === command)

	if (exactMatch) {
		return "full"
	}

	const partialMatch = allCommands.some((cmd) => cmd.name.startsWith(command))

	if (partialMatch) {
		return "partial"
	}

	return null // no match
}
