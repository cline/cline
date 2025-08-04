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
 * 1. **Subshell Detection**: Commands containing dangerous patterns like $(), ``, or (cmd1; cmd2) are flagged as security risks
 * 2. **Command Parsing**: Split chained commands (&&, ||, ;, |, &) into individual commands for separate validation
 * 3. **Pattern Matching**: For each individual command, find the longest matching prefix in both allowlist and denylist
 * 4. **Decision Logic**: Apply longest prefix match rule - more specific (longer) matches take precedence
 * 5. **Aggregation**: Combine individual decisions - if any command is denied, the entire chain is denied
 *
 * ## Security Considerations:
 *
 * - **Subshell Protection**: Detects and blocks command injection attempts via command substitution, process substitution, and subshell grouping
 * - **Chain Analysis**: Each command in a chain (cmd1 && cmd2) is validated separately to prevent bypassing via chaining
 * - **Case Insensitive**: All pattern matching is case-insensitive for consistent behavior across different input styles
 * - **Whitespace Handling**: Commands are trimmed and normalized before matching to prevent whitespace-based bypasses
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
 * Detect subshell usage and command substitution patterns that could be security risks.
 *
 * Subshells allow executing commands in isolated environments and can be used to bypass
 * command validation by hiding dangerous commands inside substitution patterns.
 *
 * Detected patterns:
 * - $() - command substitution: executes command and substitutes output
 * - `` - backticks (legacy command substitution): same as $() but older syntax
 * - <() - process substitution (input): creates temporary file descriptor for command output
 * - >() - process substitution (output): creates temporary file descriptor for command input
 * - $(()) - arithmetic expansion: evaluates mathematical expressions (can contain commands)
 * - $[] - arithmetic expansion (alternative syntax): same as $(()) but older syntax
 * - (cmd1; cmd2) - subshell grouping: executes multiple commands in isolated subshell
 *
 * @param source - The command string to analyze for subshell patterns
 * @returns true if any subshell patterns are detected, false otherwise
 *
 * @example
 * ```typescript
 * // Command substitution - executes 'date' and substitutes its output
 * containsSubshell("echo $(date)")     // true
 *
 * // Backtick substitution - legacy syntax for command substitution
 * containsSubshell("echo `date`")      // true
 *
 * // Process substitution - creates file descriptor for command output
 * containsSubshell("diff <(sort f1)")  // true
 *
 * // Arithmetic expansion - can contain command execution
 * containsSubshell("echo $((1+2))")    // true
 * containsSubshell("echo $[1+2]")      // true
 *
 * // Subshell grouping - executes commands in isolated environment
 * containsSubshell("(ls; rm file)")    // true
 * containsSubshell("(cd /tmp && rm -rf *)")  // true
 *
 * // Safe patterns that should NOT be flagged
 * containsSubshell("func(arg1, arg2)") // false - function call, not subshell
 * containsSubshell("echo hello")       // false - no subshell patterns
 * containsSubshell("(simple text)")    // false - no shell operators in parentheses
 * ```
 */
export function containsSubshell(source: string): boolean {
	// Check for command substitution, process substitution, and arithmetic expansion patterns
	// These patterns allow executing commands and substituting their output, which can bypass validation
	const commandSubstitutionPatterns = /(\$\()|`|(<\(|>\()|(\$\(\()|(\$\[)/.test(source)

	// Check for subshell grouping: parentheses containing shell command operators
	// Pattern explanation: \( = literal opening paren, [^)]* = any chars except closing paren,
	// [;&|]+ = one or more shell operators (semicolon, ampersand, pipe), [^)]* = any chars except closing paren, \) = literal closing paren
	// This detects dangerous patterns like: (cmd1; cmd2), (cmd1 && cmd2), (cmd1 || cmd2), (cmd1 | cmd2), (cmd1 & cmd2)
	// But avoids false positives like function calls: func(arg1, arg2) - no shell operators inside
	const subshellGroupingPattern = /\([^)]*[;&|]+[^)]*\)/.test(source)

	// Return true if any subshell pattern is detected
	return commandSubstitutionPatterns || subshellGroupingPattern
}

/**
 * Split a command string into individual sub-commands by
 * chaining operators (&&, ||, ;, |, or &) and newlines.
 *
 * Uses shell-quote to properly handle:
 * - Quoted strings (preserves quotes)
 * - Subshell commands ($(cmd), `cmd`, <(cmd), >(cmd))
 * - PowerShell redirections (2>&1)
 * - Chain operators (&&, ||, ;, |, &)
 * - Newlines as command separators
 */
export function parseCommand(command: string): string[] {
	if (!command?.trim()) return []

	// Split by newlines first (handle different line ending formats)
	// This regex splits on \r\n (Windows), \n (Unix), or \r (old Mac)
	const lines = command.split(/\r\n|\r|\n/)
	const allCommands: string[] = []

	for (const line of lines) {
		// Skip empty lines
		if (!line.trim()) continue

		// Process each line through the existing parsing logic
		const lineCommands = parseCommandLine(line)
		allCommands.push(...lineCommands)
	}

	return allCommands
}

/**
 * Helper function to restore placeholders in a command string
 */
function restorePlaceholders(
	command: string,
	quotes: string[],
	redirections: string[],
	arrayIndexing: string[],
	arithmeticExpressions: string[],
	parameterExpansions: string[],
	variables: string[],
	subshells: string[],
): string {
	let result = command
	// Restore quotes
	result = result.replace(/__QUOTE_(\d+)__/g, (_, i) => quotes[parseInt(i)])
	// Restore redirections
	result = result.replace(/__REDIR_(\d+)__/g, (_, i) => redirections[parseInt(i)])
	// Restore array indexing expressions
	result = result.replace(/__ARRAY_(\d+)__/g, (_, i) => arrayIndexing[parseInt(i)])
	// Restore arithmetic expressions
	result = result.replace(/__ARITH_(\d+)__/g, (_, i) => arithmeticExpressions[parseInt(i)])
	// Restore parameter expansions
	result = result.replace(/__PARAM_(\d+)__/g, (_, i) => parameterExpansions[parseInt(i)])
	// Restore variable references
	result = result.replace(/__VAR_(\d+)__/g, (_, i) => variables[parseInt(i)])
	result = result.replace(/__SUBSH_(\d+)__/g, (_, i) => subshells[parseInt(i)])
	return result
}

/**
 * Parse a single line of commands (internal helper function)
 */
function parseCommandLine(command: string): string[] {
	if (!command?.trim()) return []

	// Storage for replaced content
	const redirections: string[] = []
	const subshells: string[] = []
	const quotes: string[] = []
	const arrayIndexing: string[] = []
	const arithmeticExpressions: string[] = []
	const variables: string[] = []
	const parameterExpansions: string[] = []

	// First handle PowerShell redirections by temporarily replacing them
	let processedCommand = command.replace(/\d*>&\d*/g, (match) => {
		redirections.push(match)
		return `__REDIR_${redirections.length - 1}__`
	})

	// Handle arithmetic expressions: $((...)) pattern
	// Match the entire arithmetic expression including nested parentheses
	processedCommand = processedCommand.replace(/\$\(\([^)]*(?:\)[^)]*)*\)\)/g, (match) => {
		arithmeticExpressions.push(match)
		return `__ARITH_${arithmeticExpressions.length - 1}__`
	})

	// Handle $[...] arithmetic expressions (alternative syntax)
	processedCommand = processedCommand.replace(/\$\[[^\]]*\]/g, (match) => {
		arithmeticExpressions.push(match)
		return `__ARITH_${arithmeticExpressions.length - 1}__`
	})

	// Handle parameter expansions: ${...} patterns (including array indexing)
	// This covers ${var}, ${var:-default}, ${var:+alt}, ${#var}, ${var%pattern}, etc.
	processedCommand = processedCommand.replace(/\$\{[^}]+\}/g, (match) => {
		parameterExpansions.push(match)
		return `__PARAM_${parameterExpansions.length - 1}__`
	})

	// Handle process substitutions: <(...) and >(...)
	processedCommand = processedCommand.replace(/[<>]\(([^)]+)\)/g, (_, inner) => {
		subshells.push(inner.trim())
		return `__SUBSH_${subshells.length - 1}__`
	})

	// Handle simple variable references: $varname pattern
	// This prevents shell-quote from splitting $count into separate tokens
	processedCommand = processedCommand.replace(/\$[a-zA-Z_][a-zA-Z0-9_]*/g, (match) => {
		variables.push(match)
		return `__VAR_${variables.length - 1}__`
	})

	// Handle special bash variables: $?, $!, $#, $$, $@, $*, $-, $0-$9
	processedCommand = processedCommand.replace(/\$[?!#$@*\-0-9]/g, (match) => {
		variables.push(match)
		return `__VAR_${variables.length - 1}__`
	})

	// Then handle subshell commands $() and back-ticks
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

	let tokens: ShellToken[]
	try {
		tokens = parse(processedCommand) as ShellToken[]
	} catch (error: any) {
		// If shell-quote fails to parse, fall back to simple splitting
		console.warn("shell-quote parse error:", error.message, "for command:", processedCommand)

		// Simple fallback: split by common operators
		const fallbackCommands = processedCommand
			.split(/(?:&&|\|\||;|\||&)/)
			.map((cmd) => cmd.trim())
			.filter((cmd) => cmd.length > 0)

		// Restore all placeholders for each command
		return fallbackCommands.map((cmd) =>
			restorePlaceholders(
				cmd,
				quotes,
				redirections,
				arrayIndexing,
				arithmeticExpressions,
				parameterExpansions,
				variables,
				subshells,
			),
		)
	}

	const commands: string[] = []
	let currentCommand: string[] = []

	for (const token of tokens) {
		if (typeof token === "object" && "op" in token) {
			// Chain operator - split command
			if (["&&", "||", ";", "|", "&"].includes(token.op)) {
				if (currentCommand.length > 0) {
					commands.push(currentCommand.join(" "))
					currentCommand = []
				}
			} else {
				// Other operators (>) are part of the command
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
	return commands.map((cmd) =>
		restorePlaceholders(
			cmd,
			quotes,
			redirections,
			arrayIndexing,
			arithmeticExpressions,
			parameterExpansions,
			variables,
			subshells,
		),
	)
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
 * 2. **Command Parsing**: Split command chains (&&, ||, ;, |, &) into individual commands
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
		const hasSubshells = containsSubshell(command)

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
