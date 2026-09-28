export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "custom" | "mcp"
	cliCompatible?: boolean
}

export const BASE_SLASH_COMMANDS: SlashCommand[] = [
	// `/newtask` starts a fresh task with a clean context window — the webview
	// routes it to TaskService.clearTask (see useMessageHandlers.handleSendMessage),
	// unlike `/compact`/`/smol` which condense the current task in place.
	{
		name: "newtask",
		description: "Start a fresh task with a clean context window",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "deep-planning",
		description: "Create a comprehensive implementation plan before coding",
		section: "default",
		cliCompatible: true,
	},
	// NOTE: legacy's /newrule and /reportbug are hidden until their prompt
	// expansions are ported to the SDK runtime — without expansion the literal
	// command text reaches the model, which silently degrades to plain chat.
	{
		name: "compact",
		description: "Condenses your current context window",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "smol",
		description: "Alias for /compact",
		section: "default",
		cliCompatible: true,
	},
]

// VS Code-only slash commands
export const VSCODE_ONLY_COMMANDS: SlashCommand[] = []
