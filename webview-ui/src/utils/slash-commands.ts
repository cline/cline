export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "custom"
}

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
	{
		name: "newtask",
		description: "Create a new task with context from the current task",
		section: "default",
	},
	{
		name: "smol",
		description: "Condenses your current context window",
		section: "default",
	},
	{
		name: "newrule",
		description: "Create a new Cline rule based on your conversation",
		section: "default",
	},
	{
		name: "reportbug",
		description: "Create a Github issue with Cline",
		section: "default",
	},
]

export function getWorkflowCommands(
	localWorkflowToggles: Record<string, boolean>,
	globalWorkflowToggles: Record<string, boolean>,
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

	const workflows = [...localWorkflows, ...globalWorkflows]
	return workflows
}

// Regex for detecting slash commands in text
// currently doesn't allow whitespace inside of the filename
export const slashCommandRegex = /\/([a-zA-Z0-9_.-]+)(\s|$)/
export const slashCommandRegexGlobal = new RegExp(slashCommandRegex.source, "g")
export const slashCommandDeleteRegex = /^\s*\/([a-zA-Z0-9_.-]+)$/

/**
 * Removes a slash command at the cursor position
 */
export function removeSlashCommand(text: string, position: number): { newText: string; newPosition: number } {
	const beforeCursor = text.slice(0, position)
	const afterCursor = text.slice(position)

	// Check if we're at the end of a slash command
	const matchEnd = beforeCursor.match(slashCommandDeleteRegex)

	if (matchEnd) {
		// If we're at the end of a slash command, remove it
		const newText = text.slice(0, position - matchEnd[0].length) + afterCursor.replace(" ", "") // removes the first space after the command
		const newPosition = position - matchEnd[0].length
		return { newText, newPosition }
	}

	// If we're not at the end of a slash command, just return the original text and position
	return { newText: text, newPosition: position }
}

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
export function getMatchingSlashCommands(
	query: string,
	localWorkflowToggles: Record<string, boolean> = {},
	globalWorkflowToggles: Record<string, boolean> = {},
): SlashCommand[] {
	const workflowCommands = getWorkflowCommands(localWorkflowToggles, globalWorkflowToggles)
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
export function validateSlashCommand(
	command: string,
	localWorkflowToggles: Record<string, boolean> = {},
	globalWorkflowToggles: Record<string, boolean> = {},
): "full" | "partial" | null {
	if (!command) {
		return null
	}

	const workflowCommands = getWorkflowCommands(localWorkflowToggles, globalWorkflowToggles)
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
