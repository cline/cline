export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "custom" | "mcp"
	cliCompatible?: boolean
}

export const BASE_SLASH_COMMANDS: SlashCommand[] = [
	// `/newtask` is an alias of `/compact`: condensing achieves its goal
	// (continue working with a fresh, summarized context window) without the
	// legacy new_task tool. The webview intercepts all three spellings and
	// runs the condense RPC (see useMessageHandlers.handleSendMessage).
	{
		name: "newtask",
		description: "Condenses the current task and continues with a fresh context window",
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
	{
		name: "goal",
		description: "Start the task with a goal completion guard",
		section: "default",
		cliCompatible: true,
	},
]

// VS Code-only slash commands
export const VSCODE_ONLY_COMMANDS: SlashCommand[] = []

/**
 * A leading "/goal ..." chat message parsed into its subcommand. Mirrors the
 * CLI's /goal chat command: no arguments (or "status") reports the active
 * goal, the off aliases clear it, anything else sets a new goal.
 *
 * Shared between the controller (which answers the command) and the webview
 * (which must know that status/clear replies are local — no turn starts, no
 * user echo arrives — and that a set submission is echoed with the "/goal "
 * prefix stripped, so its optimistic bubble has to match that).
 */
export type GoalCommand = { kind: "status" } | { kind: "clear" } | { kind: "set"; goal: string }

const GOAL_CLEAR_KEYWORDS = new Set(["off", "clear", "stop", "disable"])

/**
 * Parses a chat message that invokes the /goal slash command. Returns
 * undefined for anything else (including messages that merely mention
 * "/goal" mid-text), so ordinary prompts are never hijacked.
 */
export function parseGoalCommand(text: string): GoalCommand | undefined {
	const match = /^\/goal(?=$|\s)([\s\S]*)$/i.exec(text.trim())
	if (!match) {
		return undefined
	}
	const args = (match[1] ?? "").trim()
	const keyword = args.toLowerCase()
	if (!args || keyword === "status") {
		return { kind: "status" }
	}
	if (GOAL_CLEAR_KEYWORDS.has(keyword)) {
		return { kind: "clear" }
	}
	return { kind: "set", goal: args }
}
