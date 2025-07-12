import { parse } from "shell-quote"

type ShellToken = string | { op: string } | { command: string }

/**
 * # Command Denylist Feature - Longest Prefix Match Strategy
 *
 * This module implements a sophisticated command validation system that uses the
 * "longest prefix match" strategy to resolve conflicts between allowlist and denylist patterns.
 *
 * ## Core Concept: Longest Prefix Match
 *
 * When a command matches patterns in both the allowlist and denylist, the system uses
 * the longest (most specific) match to determine the final decision. This approach
 * provides fine-grained control over command execution permissions.
 *
 * ### Examples:
 *
 * **Example 1: Specific denial overrides general allowance**
 * - Allowlist: ["git"]
 * - Denylist: ["git push"]
 * - Command: "git push origin main"
 * - Result: DENIED (denylist match "git push" is longer than allowlist match "git")
 *
 * **Example 2: Specific allowance overrides general denial**
 * - Allowlist: ["git push --dry-run"]
 * - Denylist: ["git push"]
 * - Command: "git push --dry-run origin main"
 * - Result: APPROVED (allowlist match is longer and more specific)
 *
 * **Example 3: Wildcard handling**
 * - Allowlist: ["*"]
 * - Denylist: ["rm", "sudo"]
 * - Command: "rm -rf /"
 * - Result: DENIED (specific denylist match overrides wildcard allowlist)
 *
 * ## Command Processing Pipeline:
 *
 * 1. **Subshell Detection**: Commands containing $() or `` are blocked if denylist exists
 * 2. **Command Parsing**: Split chained commands (&&, ||, ;, |) into individual commands
 * 3. **Pattern Matching**: For each command, find longest matching prefixes in both lists
 * 4. **Decision Logic**: Apply longest prefix match rule to determine approval/denial
 * 5. **Aggregation**: Combine decisions (any denial blocks the entire command chain)
 *
 * ## Security Considerations:
 *
 * - **Subshell Protection**: Prevents command injection via $(command) or `command`
 * - **Chain Analysis**: Each command in a chain (cmd1 && cmd2) is validated separately
 * - **Case Insensitive**: All matching is case-insensitive for consistency
 * - **Whitespace Handling**: Commands are trimmed and normalized before matching
 *
 * ## Configuration Merging:
 *
 * The system merges command lists from two sources with global state taking precedence:
 * 1. Global state (user preferences)
 * 2. Workspace configuration (project-specific settings)
 *
 * This allows users to have personal defaults while projects can define specific restrictions.
 */

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

	// Storage for replaced content
	const redirections: string[] = []
	const subshells: string[] = []
	const quotes: string[] = []
	const arrayIndexing: string[] = []

	// First handle PowerShell redirections by temporarily replacing them
	let processedCommand = command.replace(/\d*>&\d*/g, (match) => {
		redirections.push(match)
		return `__REDIR_${redirections.length - 1}__`
	})

	// Handle array indexing expressions: ${array[...]} pattern and partial expressions
	processedCommand = processedCommand.replace(/\$\{[^}]*\[[^\]]*(\]([^}]*\})?)?/g, (match) => {
		arrayIndexing.push(match)
		return `__ARRAY_${arrayIndexing.length - 1}__`
	})

	// Then handle subshell commands
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
		// Restore array indexing expressions
		result = result.replace(/__ARRAY_(\d+)__/g, (_, i) => arrayIndexing[parseInt(i)])
		return result
	})
}

/**
 * Find the longest matching prefix from a list of prefixes for a given command.
 *
 * This is the core function that implements the "longest prefix match" strategy.
 * It searches through all provided prefixes and returns the longest one that
 * matches the beginning of the command (case-insensitive).
 *
 * **Special Cases:**
 * - Wildcard "*" matches any command but is treated as length 1 for comparison
 * - Empty command or empty prefixes list returns null
 * - Matching is case-insensitive and uses startsWith logic
 *
 * **Examples:**
 * ```typescript
 * findLongestPrefixMatch("git push origin", ["git", "git push"])
 * // Returns "git push" (longer match)
 *
 * findLongestPrefixMatch("npm install", ["*", "npm"])
 * // Returns "npm" (specific match preferred over wildcard)
 *
 * findLongestPrefixMatch("unknown command", ["git", "npm"])
 * // Returns null (no match found)
 * ```
 *
 * @param command - The command to match against
 * @param prefixes - List of prefix patterns to search through
 * @returns The longest matching prefix, or null if no match found
 */
export function findLongestPrefixMatch(command: string, prefixes: string[]): string | null {
	if (!command || !prefixes?.length) return null

	const trimmedCommand = command.trim().toLowerCase()
	let longestMatch: string | null = null

	for (const prefix of prefixes) {
		const lowerPrefix = prefix.toLowerCase()
		// Handle wildcard "*" - it matches any command
		if (lowerPrefix === "*" || trimmedCommand.startsWith(lowerPrefix)) {
			if (!longestMatch || lowerPrefix.length > longestMatch.length) {
				longestMatch = lowerPrefix
			}
		}
	}

	return longestMatch
}

/**
 * Check if a single command should be auto-approved.
 * Returns true only for commands that explicitly match the allowlist
 * and either don't match the denylist or have a longer allowlist match.
 *
 * Special handling for wildcards: "*" in allowlist allows any command,
 * but denylist can still block specific commands.
 */
export function isAutoApprovedSingleCommand(
	command: string,
	allowedCommands: string[],
	deniedCommands?: string[],
): boolean {
	if (!command) return true

	// If no allowlist configured, nothing can be auto-approved
	if (!allowedCommands?.length) return false

	// Check if wildcard is present in allowlist
	const hasWildcard = allowedCommands.some((cmd) => cmd.toLowerCase() === "*")

	// If no denylist provided (undefined), use simple allowlist logic
	if (deniedCommands === undefined) {
		const trimmedCommand = command.trim().toLowerCase()
		return allowedCommands.some((prefix) => {
			const lowerPrefix = prefix.toLowerCase()
			// Handle wildcard "*" - it matches any command
			return lowerPrefix === "*" || trimmedCommand.startsWith(lowerPrefix)
		})
	}

	// Find longest matching prefix in both lists
	const longestDeniedMatch = findLongestPrefixMatch(command, deniedCommands)
	const longestAllowedMatch = findLongestPrefixMatch(command, allowedCommands)

	// Special case: if wildcard is present and no denylist match, auto-approve
	if (hasWildcard && !longestDeniedMatch) return true

	// Must have an allowlist match to be auto-approved
	if (!longestAllowedMatch) return false

	// If no denylist match, auto-approve
	if (!longestDeniedMatch) return true

	// Both have matches - allowlist must be longer to auto-approve
	return longestAllowedMatch.length > longestDeniedMatch.length
}

/**
 * Check if a single command should be auto-denied.
 * Returns true only for commands that explicitly match the denylist
 * and either don't match the allowlist or have a longer denylist match.
 */
export function isAutoDeniedSingleCommand(
	command: string,
	allowedCommands: string[],
	deniedCommands?: string[],
): boolean {
	if (!command) return false

	// If no denylist configured, nothing can be auto-denied
	if (!deniedCommands?.length) return false

	// Find longest matching prefix in both lists
	const longestDeniedMatch = findLongestPrefixMatch(command, deniedCommands)
	const longestAllowedMatch = findLongestPrefixMatch(command, allowedCommands || [])

	// Must have a denylist match to be auto-denied
	if (!longestDeniedMatch) return false

	// If no allowlist match, auto-deny
	if (!longestAllowedMatch) return true

	// Both have matches - denylist must be longer or equal to auto-deny
	return longestDeniedMatch.length >= longestAllowedMatch.length
}

/**
 * Check if a command string should be auto-approved.
 * Only blocks subshell attempts if there's a denylist configured.
 * Requires all sub-commands to be auto-approved.
 */
export function isAutoApprovedCommand(command: string, allowedCommands: string[], deniedCommands?: string[]): boolean {
	if (!command?.trim()) return true

	// Only block subshell execution attempts if there's a denylist configured
	if ((command.includes("$(") || command.includes("`")) && deniedCommands?.length) {
		return false
	}

	// Parse into sub-commands (split by &&, ||, ;, |)
	const subCommands = parseCommand(command)

	// Ensure every sub-command is auto-approved
	return subCommands.every((cmd) => {
		// Remove simple PowerShell-like redirections (e.g. 2>&1) before checking
		const cmdWithoutRedirection = cmd.replace(/\d*>&\d*/, "").trim()

		return isAutoApprovedSingleCommand(cmdWithoutRedirection, allowedCommands, deniedCommands)
	})
}

/**
 * Check if a command string should be auto-denied.
 * Only blocks subshell attempts if there's a denylist configured.
 * Auto-denies if any sub-command is auto-denied.
 */
export function isAutoDeniedCommand(command: string, allowedCommands: string[], deniedCommands?: string[]): boolean {
	if (!command?.trim()) return false

	// Only block subshell execution attempts if there's a denylist configured
	if ((command.includes("$(") || command.includes("`")) && deniedCommands?.length) {
		return true
	}

	// Parse into sub-commands (split by &&, ||, ;, |)
	const subCommands = parseCommand(command)

	// Auto-deny if any sub-command is auto-denied
	return subCommands.some((cmd) => {
		// Remove simple PowerShell-like redirections (e.g. 2>&1) before checking
		const cmdWithoutRedirection = cmd.replace(/\d*>&\d*/, "").trim()

		return isAutoDeniedSingleCommand(cmdWithoutRedirection, allowedCommands, deniedCommands)
	})
}

/**
 * Command approval decision types
 */
export type CommandDecision = "auto_approve" | "auto_deny" | "ask_user"

/**
 * Unified command validation that implements the longest prefix match rule.
 * Returns a definitive decision for a command based on allowlist and denylist.
 *
 * This is the main entry point for command validation in the Command Denylist feature.
 * It handles complex command chains and applies the longest prefix match strategy
 * to resolve conflicts between allowlist and denylist patterns.
 *
 * **Decision Logic:**
 * 1. **Subshell Protection**: If subshells ($() or ``) are present and denylist exists → auto-deny
 * 2. **Command Parsing**: Split command chains (&&, ||, ;, |) into individual commands
 * 3. **Individual Validation**: For each sub-command, apply longest prefix match rule
 * 4. **Aggregation**: Combine decisions using "any denial blocks all" principle
 *
 * **Return Values:**
 * - `"auto_approve"`: All sub-commands are explicitly allowed
 * - `"auto_deny"`: At least one sub-command is explicitly denied
 * - `"ask_user"`: Mixed or no matches found, requires user decision
 *
 * **Examples:**
 * ```typescript
 * // Simple approval
 * getCommandDecision("git status", ["git"], [])
 * // Returns "auto_approve"
 *
 * // Longest prefix match - denial wins
 * getCommandDecision("git push origin", ["git"], ["git push"])
 * // Returns "auto_deny"
 *
 * // Command chain - any denial blocks all
 * getCommandDecision("git status && rm file", ["git"], ["rm"])
 * // Returns "auto_deny"
 *
 * // No matches - ask user
 * getCommandDecision("unknown command", ["git"], ["rm"])
 * // Returns "ask_user"
 * ```
 *
 * @param command - The full command string to validate
 * @param allowedCommands - List of allowed command prefixes
 * @param deniedCommands - Optional list of denied command prefixes
 * @returns Decision indicating whether to approve, deny, or ask user
 */
export function getCommandDecision(
	command: string,
	allowedCommands: string[],
	deniedCommands?: string[],
): CommandDecision {
	if (!command?.trim()) return "auto_approve"

	// Only block subshell execution attempts if there's a denylist configured
	if ((command.includes("$(") || command.includes("`")) && deniedCommands?.length) {
		return "auto_deny"
	}

	// Parse into sub-commands (split by &&, ||, ;, |)
	const subCommands = parseCommand(command)

	// Check each sub-command and collect decisions
	const decisions: CommandDecision[] = subCommands.map((cmd) => {
		// Remove simple PowerShell-like redirections (e.g. 2>&1) before checking
		const cmdWithoutRedirection = cmd.replace(/\d*>&\d*/, "").trim()

		return getSingleCommandDecision(cmdWithoutRedirection, allowedCommands, deniedCommands)
	})

	// If any sub-command is denied, deny the whole command
	if (decisions.includes("auto_deny")) {
		return "auto_deny"
	}

	// If all sub-commands are approved, approve the whole command
	if (decisions.every((decision) => decision === "auto_approve")) {
		return "auto_approve"
	}

	// Otherwise, ask user
	return "ask_user"
}

/**
 * Get the decision for a single command using longest prefix match rule.
 *
 * This is the core logic that implements the conflict resolution between
 * allowlist and denylist using the "longest prefix match" strategy.
 *
 * **Longest Prefix Match Algorithm:**
 * 1. Find the longest matching prefix in the allowlist
 * 2. Find the longest matching prefix in the denylist
 * 3. Compare lengths to determine which rule takes precedence
 * 4. Longer (more specific) match wins the conflict
 *
 * **Decision Matrix:**
 * | Allowlist Match | Denylist Match | Result | Reason |
 * |----------------|----------------|---------|---------|
 * | Yes | No | auto_approve | Only allowlist matches |
 * | No | Yes | auto_deny | Only denylist matches |
 * | Yes | Yes (shorter) | auto_approve | Allowlist is more specific |
 * | Yes | Yes (longer/equal) | auto_deny | Denylist is more specific |
 * | No | No | ask_user | No rules apply |
 *
 * **Examples:**
 * ```typescript
 * // Only allowlist matches
 * getSingleCommandDecision("git status", ["git"], ["npm"])
 * // Returns "auto_approve"
 *
 * // Denylist is more specific
 * getSingleCommandDecision("git push origin", ["git"], ["git push"])
 * // Returns "auto_deny" (denylist "git push" > allowlist "git")
 *
 * // Allowlist is more specific
 * getSingleCommandDecision("git push --dry-run", ["git push --dry-run"], ["git push"])
 * // Returns "auto_approve" (allowlist is longer)
 *
 * // No matches
 * getSingleCommandDecision("unknown", ["git"], ["npm"])
 * // Returns "ask_user"
 * ```
 *
 * @param command - Single command to validate (no chaining)
 * @param allowedCommands - List of allowed command prefixes
 * @param deniedCommands - Optional list of denied command prefixes
 * @returns Decision for this specific command
 */
export function getSingleCommandDecision(
	command: string,
	allowedCommands: string[],
	deniedCommands?: string[],
): CommandDecision {
	if (!command) return "auto_approve"

	// Find longest matching prefixes in both lists
	const longestAllowedMatch = findLongestPrefixMatch(command, allowedCommands || [])
	const longestDeniedMatch = findLongestPrefixMatch(command, deniedCommands || [])

	// If only allowlist has a match, auto-approve
	if (longestAllowedMatch && !longestDeniedMatch) {
		return "auto_approve"
	}

	// If only denylist has a match, auto-deny
	if (!longestAllowedMatch && longestDeniedMatch) {
		return "auto_deny"
	}

	// Both lists have matches - apply longest prefix match rule
	if (longestAllowedMatch && longestDeniedMatch) {
		return longestAllowedMatch.length > longestDeniedMatch.length ? "auto_approve" : "auto_deny"
	}

	// If neither list has a match, ask user
	return "ask_user"
}

/**
 * Centralized Command Validation Service
 *
 * This class provides a unified interface for all command validation operations
 * in the Command Denylist feature. It encapsulates the validation logic and
 * provides convenient methods for different validation scenarios.
 */
export class CommandValidator {
	constructor(
		private allowedCommands: string[],
		private deniedCommands?: string[],
	) {}

	/**
	 * Update the command lists used for validation
	 */
	updateCommandLists(allowedCommands: string[], deniedCommands?: string[]) {
		this.allowedCommands = allowedCommands
		this.deniedCommands = deniedCommands
	}

	/**
	 * Get the current command lists
	 */
	getCommandLists() {
		return {
			allowedCommands: [...this.allowedCommands],
			deniedCommands: this.deniedCommands ? [...this.deniedCommands] : undefined,
		}
	}

	/**
	 * Validate a command and return a decision
	 * This is the main validation method that should be used for all command validation
	 */
	validateCommand(command: string): CommandDecision {
		return getCommandDecision(command, this.allowedCommands, this.deniedCommands)
	}

	/**
	 * Check if a command would be auto-approved
	 */
	isAutoApproved(command: string): boolean {
		return this.validateCommand(command) === "auto_approve"
	}

	/**
	 * Check if a command would be auto-denied
	 */
	isAutoDenied(command: string): boolean {
		return this.validateCommand(command) === "auto_deny"
	}

	/**
	 * Check if a command requires user input
	 */
	requiresUserInput(command: string): boolean {
		return this.validateCommand(command) === "ask_user"
	}

	/**
	 * Get detailed validation information for a command
	 * Useful for debugging and providing user feedback
	 */
	getValidationDetails(command: string): {
		decision: CommandDecision
		subCommands: string[]
		allowedMatches: Array<{ command: string; match: string | null }>
		deniedMatches: Array<{ command: string; match: string | null }>
		hasSubshells: boolean
	} {
		const subCommands = parseCommand(command)
		const hasSubshells = command.includes("$(") || command.includes("`")

		const allowedMatches = subCommands.map((cmd) => ({
			command: cmd,
			match: findLongestPrefixMatch(cmd.replace(/\d*>&\d*/, "").trim(), this.allowedCommands),
		}))

		const deniedMatches = subCommands.map((cmd) => ({
			command: cmd,
			match: findLongestPrefixMatch(cmd.replace(/\d*>&\d*/, "").trim(), this.deniedCommands || []),
		}))

		return {
			decision: this.validateCommand(command),
			subCommands,
			allowedMatches,
			deniedMatches,
			hasSubshells,
		}
	}

	/**
	 * Validate multiple commands at once
	 * Returns a map of command to decision
	 */
	validateCommands(commands: string[]): Map<string, CommandDecision> {
		const results = new Map<string, CommandDecision>()
		for (const command of commands) {
			results.set(command, this.validateCommand(command))
		}
		return results
	}

	/**
	 * Check if the validator has any rules configured
	 */
	hasRules(): boolean {
		return this.allowedCommands.length > 0 || (this.deniedCommands?.length ?? 0) > 0
	}

	/**
	 * Get statistics about the current configuration
	 */
	getStats() {
		return {
			allowedCount: this.allowedCommands.length,
			deniedCount: this.deniedCommands?.length ?? 0,
			hasWildcard: this.allowedCommands.some((cmd) => cmd.toLowerCase() === "*"),
			hasRules: this.hasRules(),
		}
	}
}

/**
 * Factory function to create a CommandValidator instance
 * This is the recommended way to create validators in the application
 */
export function createCommandValidator(allowedCommands: string[], deniedCommands?: string[]): CommandValidator {
	return new CommandValidator(allowedCommands, deniedCommands)
}
