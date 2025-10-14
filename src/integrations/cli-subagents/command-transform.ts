/**
 * Enable debug logging for CLI subagent command transformation.
 * Set to true to see detailed logs about command parsing and transformation.
 */
const DEBUG_LOGGING = true

/**
 * Pattern to match simplified Cline CLI syntax: cline "prompt" or cline 'prompt'
 * with optional additional flags after the closing quote
 */
const CLINE_COMMAND_PATTERN = /^cline\s+(['"])(.+?)\1(\s+.*)?$/

/**
 * Detects if a command is a Cline CLI subagent command.
 *
 * Matches both simplified syntax (cline "prompt") and full syntax (cline t o "prompt").
 * This allows the system to apply subagent-specific settings like higher output line limits.
 *
 * @param command - The command string to check
 * @returns True if the command is a Cline CLI subagent command, false otherwise
 */
export function isSubagentCommand(command: string): boolean {
	// Match simplified syntaxes
	// cline "prompt"
	// cline 'prompt'
	if (CLINE_COMMAND_PATTERN.test(command)) {
		return true
	}

	// Match addnl syntax (in case the model starts mimicking after seeing terminal outputs)
	// cline t o "prompt" ...
	const fullPattern = /^cline\s+t\s+o\s+/
	if (fullPattern.test(command)) {
		return true
	}

	return false
}

/**
 * Transforms simplified Cline CLI command syntax into the full required syntax.
 *
 * Converts: cline "prompt" or cline 'prompt'
 * To: cline t o "prompt" -o plain
 *
 * Preserves additional flags like --workdir:
 * cline "prompt" --workdir ./path → cline t o "prompt" -o plain --workdir ./path
 *
 * This simplifies the command syntax for AI agents while maintaining backward
 * compatibility with the full syntax.
 *
 * @param command - The command string to potentially transform
 * @returns The transformed command if it matches the pattern, otherwise the original command
 */
export function transformClineCommand(command: string): string {
	if (DEBUG_LOGGING) {
		console.log("[CLI-SUBAGENTS] Received command:", command)
	}

	if (!isSubagentCommand(command)) {
		return command
	}

	// Inject subagent-specific command structure and settings
	const commandWithSettings = injectSubagentSettings(command)

	if (DEBUG_LOGGING) {
		console.log("[CLI-SUBAGENTS] Final command with settings:", commandWithSettings)
	}

	return commandWithSettings
}

/**
 * Injects subagent-specific command structure and settings into Cline CLI commands.
 *
 * @param command - The Cline CLI command (simplified or full syntax)
 * @returns The command with injected flags and settings
 */
function injectSubagentSettings(command: string): string {
	// Flags to insert before the prompt
	const prePromptFlags = ["t", "o"]

	// Flags/settings to insert after the prompt
	const postPromptFlags = ["-s auto_approval_settings.max_requests=100", "-s auto_approval_settings.enable_notifications=false"]

	const match = command.match(CLINE_COMMAND_PATTERN)

	if (match) {
		const quote = match[1]
		const prompt = match[2]
		const additionalFlags = match[3] || ""
		return `cline ${prePromptFlags.join(" ")} ${quote}${prompt}${quote} ${postPromptFlags.join(" ")} -o plain${additionalFlags}`
	}

	// Already full format: just inject settings after prompt
	const parts = command.split(" ")
	const promptEndIndex = parts.findIndex((p) => p.endsWith('"') || p.endsWith("'"))
	if (promptEndIndex !== -1) {
		parts.splice(promptEndIndex + 1, 0, ...postPromptFlags)
	}
	return parts.join(" ")
}
