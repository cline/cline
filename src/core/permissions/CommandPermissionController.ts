import { ParseEntry, parse } from "shell-quote"
import { COMMAND_PERMISSIONS_ENV_VAR, CommandPermissionConfig, PermissionValidationResult, ShellOperatorMatch } from "./types"

const OPERATOR_DESCRIPTIONS: Record<string, string> = {
	";": "command chaining (semicolon)",
	"&&": "command chaining (AND)",
	"||": "command chaining (OR)",
	"|": "pipe",
	">": "output redirection",
	">>": "append redirection",
	"<": "input redirection",
	">&": "file descriptor redirection",
	"<&": "file descriptor duplication",
	"|&": "pipe with stderr",
}

const LINE_SEPARATOR_REGEX = /[\n\r\u2028\u2029\u0085]/
const LINE_SEPARATOR_DESCRIPTIONS: Record<string, ShellOperatorMatch> = {
	"\n": { operator: "\\n", description: "newline (command separator)" },
	"\r": { operator: "\\r", description: "carriage return (potential command separator)" },
	"\u2028": { operator: "U+2028", description: "unicode line separator" },
	"\u2029": { operator: "U+2029", description: "unicode paragraph separator" },
	"\u0085": { operator: "U+0085", description: "unicode next line" },
}

/**
 * Controls command execution permissions based on environment variable configuration.
 * Uses glob pattern matching to allow/deny specific commands.
 *
 * Configuration is read from the CLINE_COMMAND_PERMISSIONS environment variable.
 * Format: {"allow": ["pattern1", "pattern2"], "deny": ["pattern3"]}
 *
 * Rule evaluation:
 * 1. If shell operators are detected outside quotes → DENIED (security)
 * 2. If deny rules are defined and command matches a deny pattern → DENIED
 * 3. If allow rules are defined and command matches an allow pattern → ALLOWED
 * 4. If allow rules are defined but command doesn't match any → DENIED (deny by default)
 * 5. If no rules are defined (env var not set) → ALLOWED (backward compatibility)
 */
export class CommandPermissionController {
	private config: CommandPermissionConfig | null = null

	constructor() {
		this.config = this.parseConfig()
	}

	/**
	 * Parse the CLINE_COMMAND_PERMISSIONS environment variable
	 * @returns Parsed configuration or null if not set or invalid
	 */
	private parseConfig(): CommandPermissionConfig | null {
		const envValue = process.env[COMMAND_PERMISSIONS_ENV_VAR]
		if (!envValue) {
			return null
		}

		try {
			const parsed = JSON.parse(envValue)
			return {
				allow: Array.isArray(parsed.allow) ? parsed.allow : undefined,
				deny: Array.isArray(parsed.deny) ? parsed.deny : undefined,
				allowOperators: Array.isArray(parsed.allowOperators) ? parsed.allowOperators : undefined,
			}
		} catch (error) {
			console.error(`Failed to parse ${COMMAND_PERMISSIONS_ENV_VAR}:`, error)
			return null
		}
	}

	/**
	 * Check if an operator is in the allowOperators list
	 * @param operator - The operator to check
	 * @returns true if the operator is allowed
	 */
	private isOperatorAllowed(operator: string): boolean {
		return Boolean(this.config?.allowOperators?.includes(operator))
	}

	/**
	 * Validate if a command is allowed to execute based on configured permissions
	 * @param command - The command string to validate
	 * @returns PermissionValidationResult indicating if command is allowed and why
	 */
	validateCommand(command: string): PermissionValidationResult {
		// No config = allow everything (backward compatibility)
		if (!this.config) {
			return { allowed: true, reason: "no_config" }
		}

		// Check for shell operators FIRST (security check)
		const shellOperator = this.detectShellOperator(command)
		if (shellOperator) {
			return {
				allowed: false,
				reason: "shell_operator_detected",
				detectedOperator: shellOperator.operator,
			}
		}

		// Check deny rules first (deny takes precedence)
		if (this.config.deny) {
			for (const pattern of this.config.deny) {
				if (this.matchesPattern(command, pattern)) {
					return { allowed: false, matchedPattern: pattern, reason: "denied" }
				}
			}
		}

		// Check allow rules
		if (this.config.allow && this.config.allow.length > 0) {
			for (const pattern of this.config.allow) {
				if (this.matchesPattern(command, pattern)) {
					return { allowed: true, matchedPattern: pattern, reason: "allowed" }
				}
			}
			// Allow rules defined but no match = deny by default
			return { allowed: false, reason: "no_match_deny_default" }
		}

		// No allow rules defined, and no deny matched = allow
		return { allowed: true, reason: "no_config" }
	}

	/**
	 * Check if a command matches a wildcard pattern.
	 *
	 * Uses simple wildcard matching where `*` matches any characters (including `/` and newlines).
	 * This is different from file glob matching where `*` doesn't cross directory boundaries.
	 * For command permission matching, we want `*` to match any sequence of characters
	 * so that patterns like `gh pr comment *` match `gh pr comment 123 --body-file /tmp/file.txt`
	 * or commands with multiline arguments like `gh pr comment 123 --body "line1\nline2"`.
	 *
	 * Supported patterns:
	 * - `*` matches any sequence of characters (including / and newlines)
	 * - `?` matches exactly one character
	 *
	 * @param command - The command to check
	 * @param pattern - The wildcard pattern to match against
	 * @returns true if command matches the pattern
	 */
	private matchesPattern(command: string, pattern: string): boolean {
		const regex = new RegExp(
			"^" +
				pattern
					.replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
					.replace(/\*/g, ".*") // * becomes .*
					.replace(/\?/g, ".") + // ? becomes .
				"$",
			"s", // s flag enables dotAll (. matches newlines)
		)
		return regex.test(command)
	}

	/**
	 * Detect shell operators using shell-quote parser.
	 * This prevents command chaining/injection attacks like:
	 *   gh pr view 123; rm -rf /
	 *   gh pr view 123 && malicious_command
	 *   gh pr view $(malicious_command)
	 *
	 * Operators inside quotes are allowed (they're literal characters):
	 *   echo "hello; world"  # OK - semicolon is inside quotes
	 *
	 * @param command - The command string to check
	 * @returns ShellOperatorMatch if an operator is found outside quotes, null otherwise
	 */
	private detectShellOperator(command: string): ShellOperatorMatch | null {
		const dangerousCharMatch = this.detectDangerousCharsOutsideQuotes(command)
		if (dangerousCharMatch) {
			return dangerousCharMatch
		}

		try {
			// Parse the command using shell-quote
			// shell-quote returns an array where:
			// - strings are regular arguments
			// - objects with 'op' key are shell operators
			// - objects with 'comment' key are comments
			// - objects with 'pattern' key are glob patterns (we allow these)
			const parsed = parse(command, (varName: string) => `$${varName}`)

			// Check each parsed element for operators
			for (const entry of parsed) {
				const operatorMatch = this.checkParsedEntry(entry)
				if (operatorMatch) {
					return operatorMatch
				}
			}

			return null
		} catch {
			// If parsing fails, be conservative and block the command
			// This could indicate malformed shell syntax being used for injection
			return { operator: "parse_error", description: "command parsing failed (potential injection)" }
		}
	}

	/**
	 * Detect dangerous characters outside of quoted strings.
	 * This includes newlines, carriage returns, unicode line separators, and backticks.
	 *
	 * For newlines/carriage returns: They are safe inside ANY quotes (single or double)
	 * because they become literal characters in the argument value.
	 *
	 * For backticks: They are only safe inside SINGLE quotes because double quotes
	 * still allow command substitution.
	 *
	 * Examples:
	 *   gh pr comment 123 --body "line1\nline2"  -> ALLOWED (newline in quotes)
	 *   gh pr comment 123\nrm -rf /              -> BLOCKED (newline outside quotes)
	 *   echo `date`                              -> BLOCKED (backtick outside quotes)
	 *   echo "hello `date`"                      -> BLOCKED (backtick in double quotes - executes!)
	 *   echo 'hello `date`'                      -> ALLOWED (backtick in single quotes - literal)
	 *
	 * @param command - The command string to check
	 * @returns ShellOperatorMatch if dangerous chars found outside appropriate quotes, null otherwise
	 */
	private detectDangerousCharsOutsideQuotes(command: string): ShellOperatorMatch | null {
		let inSingleQuote = false
		let inDoubleQuote = false
		let isEscaped = false

		for (let i = 0; i < command.length; i++) {
			const char = command[i]

			// If previous char was an unescaped backslash, this char is escaped
			if (isEscaped) {
				isEscaped = false
				continue
			}

			// Check for escape sequence (only outside single quotes)
			// In single quotes, backslashes are literal
			if (char === "\\" && !inSingleQuote) {
				isEscaped = true
				continue
			}

			// Handle double quotes - we track them to know when single quotes are literal
			if (char === '"' && !inSingleQuote) {
				inDoubleQuote = !inDoubleQuote
				continue
			}

			// Handle single quotes - only toggle when NOT inside double quotes
			// Inside double quotes, single quotes are literal characters
			if (char === "'" && !inDoubleQuote) {
				inSingleQuote = !inSingleQuote
				continue
			}

			const inAnyQuote = inSingleQuote || inDoubleQuote

			// Check for newlines and carriage returns outside ANY quotes
			// These are command separators when outside quotes
			if (!inAnyQuote && LINE_SEPARATOR_REGEX.test(char)) {
				return LINE_SEPARATOR_DESCRIPTIONS[char]
			}

			// Check for backticks outside SINGLE quotes only
			// Backticks in double quotes ARE executed as command substitution in bash
			if (char === "`" && !inSingleQuote) {
				return { operator: "`", description: "command substitution (backtick)" }
			}
		}

		return null
	}

	/**
	 * Check a parsed entry from shell-quote for dangerous operators.
	 *
	 * @param entry - A parsed entry from shell-quote
	 * @returns ShellOperatorMatch if dangerous operator found, null otherwise
	 */
	private checkParsedEntry(entry: ParseEntry): ShellOperatorMatch | null {
		// null entries, string entries, glob patterns, and comments are safe
		if (!entry || typeof entry === "string" || "pattern" in entry || "comment" in entry) {
			return null
		}

		if (typeof entry.op === "string") {
			if (this.isOperatorAllowed(entry.op)) {
				return null
			}
			const description = OPERATOR_DESCRIPTIONS[entry.op] || `shell operator (${entry.op})`
			return { operator: entry.op, description }
		}

		return null
	}
}
