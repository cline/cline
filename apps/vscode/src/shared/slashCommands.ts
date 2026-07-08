export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "custom" | "mcp"
}

export const BASE_SLASH_COMMANDS: SlashCommand[] = [
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

// VS Code-only slash commands
export const VSCODE_ONLY_COMMANDS: SlashCommand[] = []
