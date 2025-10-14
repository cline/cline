/**
 * Enable debug logging for CLI subagent command transformation.
 * Set to true to see detailed logs about command parsing and transformation.
 */
const DEBUG_LOGGING = true

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
	const simplifiedPattern = /^cline\s+(['"])(.+?)\1(\s+.*)?$/
	if (simplifiedPattern.test(command)) {
		return true
	}

	// Match full syntax (in case the model starts mimicking after seeing terminal outputs)
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

	// Pattern to match: cline followed by a quoted string (single or double quotes)
	// with optional additional flags after the closing quote
	const simplifiedPattern = /^cline\s+(['"])(.+?)\1(\s+.*)?$/
	const match = command.match(simplifiedPattern)

	if (DEBUG_LOGGING) {
		console.log("[CLI-SUBAGENTS] Pattern matched:", !!match)
		if (match) {
			console.log("[CLI-SUBAGENTS] Match groups:")
			console.log("  - Full match:", match[0])
			console.log("  - Quote type:", match[1])
			console.log("  - Prompt:", match[2])
			console.log("  - Additional flags:", match[3] || "(none)")
		}
	}

	// Return original command if it doesn't match the simplified pattern
	if (!match) {
		if (DEBUG_LOGGING) {
			console.log("[CLI-SUBAGENTS] No transformation - returning original command")
		}
		return command
	}

	const quoteType = match[1] // Will be either ' or "
	const prompt = match[2]
	const additionalFlags = match[3] || "" // Preserve any additional flags (like --workdir)

	// Transform to full syntax, preserving the original quote type and any additional flags
	const transformedCommand = `cline t o ${quoteType}${prompt}${quoteType} -o plain${additionalFlags}`

	if (DEBUG_LOGGING) {
		console.log("[CLI-SUBAGENTS] Transformed command:", transformedCommand)
	}

	return transformedCommand
}
