/**
 * Pattern to match simplified Cline CLI syntax: cline "prompt" or cline 'prompt'
 * with optional additional flags after the closing quote
 */
const CLINE_COMMAND_PATTERN = /^cline\s+(['"])(.+?)\1(\s+.*)?$/

/**
 * Detects if a command is a Cline CLI subagent command.
 *
 * Matches the simplified syntax: cline "prompt" or cline 'prompt'
 * This allows the system to apply subagent-specific settings like autonomous execution.
 *
 * @param command - The command string to check
 * @returns True if the command is a Cline CLI subagent command, false otherwise
 */
export function isSubagentCommand(command: string): boolean {
	// Match simplified syntaxes
	// cline "prompt"
	// cline 'prompt'
	return CLINE_COMMAND_PATTERN.test(command)
}

/**
 * Transforms simplified Cline CLI command syntax with subagent settings.
 *
 * Converts: cline "prompt" or cline 'prompt'
 * To: cline "prompt" -s yolo_mode_toggled=true -s max_consecutive_mistakes=6 -F plain -y --oneshot
 *
 * Preserves additional flags like --workdir:
 * cline "prompt" --workdir ./path → cline "prompt" -s ... -F plain -y --oneshot --workdir ./path
 *
 * This enables autonomous subagent execution with proper CLI flags for automation.
 *
 * @param command - The command string to potentially transform
 * @returns The transformed command if it matches the pattern, otherwise the original command
 */
export function transformClineCommand(command: string): string {
	if (!isSubagentCommand(command)) {
		return command
	}

	// Inject subagent-specific command structure and settings
	const commandWithSettings = injectSubagentSettings(command)

	return commandWithSettings
}

/**
 * Injects subagent-specific command structure and settings into Cline CLI commands.
 *
 * @param command - The Cline CLI command (simplified or full syntax)
 * @returns The command with injected flags and settings
 */
function injectSubagentSettings(command: string): string {
	// No pre-prompt flags needed - use standard "cline 'prompt'" syntax
	const prePromptFlags: string[] = []

	// Flags/settings to insert after the prompt
	const postPromptFlags = ["-s yolo_mode_toggled=true", "-s max_consecutive_mistakes=6", "-F plain", "-y", "--oneshot"]

	const match = command.match(CLINE_COMMAND_PATTERN)

	if (match) {
		const quote = match[1]
		const prompt = match[2]
		const additionalFlags = match[3] || ""
		const prePromptPart = prePromptFlags.length > 0 ? prePromptFlags.join(" ") + " " : ""
		return `cline ${prePromptPart}${quote}${prompt}${quote} ${postPromptFlags.join(" ")}${additionalFlags}`
	}

	// Already full format: just inject settings after prompt
	const parts = command.split(" ")
	const promptEndIndex = parts.findIndex((p) => p.endsWith('"') || p.endsWith("'"))
	if (promptEndIndex !== -1) {
		parts.splice(promptEndIndex + 1, 0, ...postPromptFlags)
	}
	return parts.join(" ")
}
