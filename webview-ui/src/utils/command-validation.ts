import { parse } from "shell-quote"

type ShellToken = string | { op: string } | { command: string }

/**
 * Split a command string into individual sub-commands by
 * chaining operators (&&, ||, ;, or |).
 *
 * Uses shell-quote to properly handle:
 * - Quoted strings (preserves quotes)
 * - Subshell commands ($(cmd) or `cmd`)
 * - PowerShell redirections (2>&1)
 * - Chain operators (&&, ||, ;, |)
 */
export function parseCommand(command: string): string[] {
	if (!command?.trim()) return []

	// First handle PowerShell redirections by temporarily replacing them
	const redirections: string[] = []
	let processedCommand = command.replace(/\d*>&\d*/g, (match) => {
		redirections.push(match)
		return `__REDIR_${redirections.length - 1}__`
	})

	// Then handle subshell commands
	const subshells: string[] = []
	processedCommand = processedCommand
		.replace(/\$\((.*?)\)/g, (_, inner) => {
			subshells.push(inner.trim())
			return `__SUBSH_${subshells.length - 1}__`
		})
		.replace(/`(.*?)`/g, (_, inner) => {
			subshells.push(inner.trim())
			return `__SUBSH_${subshells.length - 1}__`
		})

	// Then handle quoted strings
	const quotes: string[] = []
	processedCommand = processedCommand.replace(/"[^"]*"/g, (match) => {
		quotes.push(match)
		return `__QUOTE_${quotes.length - 1}__`
	})

	const tokens = parse(processedCommand) as ShellToken[]
	const commands: string[] = []
	let currentCommand: string[] = []

	for (const token of tokens) {
		if (typeof token === "object" && "op" in token) {
			// Chain operator - split command
			if (["&&", "||", ";", "|"].includes(token.op)) {
				if (currentCommand.length > 0) {
					commands.push(currentCommand.join(" "))
					currentCommand = []
				}
			} else {
				// Other operators (>, &) are part of the command
				currentCommand.push(token.op)
			}
		} else if (typeof token === "string") {
			// Check if it's a subshell placeholder
			const subshellMatch = token.match(/__SUBSH_(\d+)__/)
			if (subshellMatch) {
				if (currentCommand.length > 0) {
					commands.push(currentCommand.join(" "))
					currentCommand = []
				}
				commands.push(subshells[parseInt(subshellMatch[1])])
			} else {
				currentCommand.push(token)
			}
		}
	}

	// Add any remaining command
	if (currentCommand.length > 0) {
		commands.push(currentCommand.join(" "))
	}

	// Restore quotes and redirections
	return commands.map((cmd) => {
		let result = cmd
		// Restore quotes
		result = result.replace(/__QUOTE_(\d+)__/g, (_, i) => quotes[parseInt(i)])
		// Restore redirections
		result = result.replace(/__REDIR_(\d+)__/g, (_, i) => redirections[parseInt(i)])
		return result
	})
}

/**
 * Check if a single command is allowed based on prefix matching.
 */
export function isAllowedSingleCommand(command: string, allowedCommands: string[]): boolean {
	if (!command || !allowedCommands?.length) return false
	const trimmedCommand = command.trim().toLowerCase()
	return allowedCommands.some((prefix) => trimmedCommand.startsWith(prefix.toLowerCase()))
}

/**
 * Check if a command string is allowed based on the allowed command prefixes.
 * This version also blocks subshell attempts by checking for `$(` or `` ` ``.
 */
export function validateCommand(command: string, allowedCommands: string[]): boolean {
	if (!command?.trim()) return true

	// If '*' is in allowed commands, everything is allowed
	if (allowedCommands?.includes("*")) return true

	// Block subshell execution attempts
	if (command.includes("$(") || command.includes("`")) {
		return false
	}

	// Parse into sub-commands (split by &&, ||, ;, |)
	const subCommands = parseCommand(command)

	// Then ensure every sub-command starts with an allowed prefix
	return subCommands.every((cmd) => {
		// Remove simple PowerShell-like redirections (e.g. 2>&1) before checking
		const cmdWithoutRedirection = cmd.replace(/\d*>&\d*/, "").trim()
		return isAllowedSingleCommand(cmdWithoutRedirection, allowedCommands)
	})
}
