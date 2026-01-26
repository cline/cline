import { ParseEntry, parse } from "shell-quote"
import { Logger } from "@/shared/services/Logger"
import { COMMAND_PERMISSIONS_ENV_VAR, CommandPermissionConfig, PermissionValidationResult, ShellOperatorMatch } from "./types"

const REDIRECT_OPERATORS = new Set([">", ">>", "<", ">&", "<&", "|&", "<(", ">("])
const COMMAND_SEPARATOR_OPERATORS = new Set(["&&", "||", "|", ";"])

const LINE_SEPARATOR_REGEX = /[\n\r\u2028\u2029\u0085]/
const LINE_SEPARATOR_DESCRIPTIONS: Record<string, ShellOperatorMatch> = {
	"\n": { operator: "\\n", description: "newline (command separator)" },
	"\r": { operator: "\\r", description: "carriage return (potential command separator)" },
	"\u2028": { operator: "U+2028", description: "unicode line separator" },
	"\u2029": { operator: "U+2029", description: "unicode paragraph separator" },
	"\u0085": { operator: "U+0085", description: "unicode next line" },
}

/**
 * Result of parsing a command into segments (recursive structure)
 */
interface ParsedCommand {
	segments: string[] // Individual commands between operators
	subshells: ParsedCommand[] // Recursively parsed contents of (...) and $(...)
	hasRedirects: boolean // Whether redirect operators (>, >>, <, etc.) were found
}

/**
 * Controls command execution permissions based on environment variable configuration.
 * Uses glob pattern matching to allow/deny specific commands.
 *
 * Configuration is read from the CLINE_COMMAND_PERMISSIONS environment variable.
 * Format: {"allow": ["pattern1", "pattern2"], "deny": ["pattern3"], "allowRedirects": true}
 *
 * Rule evaluation for chained commands (e.g., "cd /tmp && npm test"):
 * 1. Parse command into segments split by operators (&&, ||, |, ;)
 * 2. Check for dangerous characters (backticks outside single quotes, newlines outside quotes)
 * 3. If redirects detected and allowRedirects !== true → DENIED
 * 4. Validate EACH segment against allow/deny rules - ALL must pass
 * 5. Recursively validate any subshell contents
 * 6. If no rules are defined (env var not set) → ALLOWED (backward compatibility)
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
				allowRedirects: typeof parsed.allowRedirects === "boolean" ? parsed.allowRedirects : undefined,
			}
		} catch (error) {
			Logger.error(`Failed to parse ${COMMAND_PERMISSIONS_ENV_VAR}:`, error)
			return null
		}
	}

	/**
	 * Validate if a command is allowed to execute based on configured permissions.
	 * For chained commands (using &&, ||, |, ;), each segment is validated separately.
	 *
	 * @param command - The command string to validate
	 * @returns PermissionValidationResult indicating if command is allowed and why
	 */
	validateCommand(command: string): PermissionValidationResult {
		// No config = allow everything (backward compatibility)
		if (!this.config) {
			return { allowed: true, reason: "no_config" }
		}

		// Check for dangerous characters first (backticks in double quotes, newlines outside quotes)
		const dangerousChar = this.detectDangerousCharsOutsideQuotes(command)
		if (dangerousChar) {
			return {
				allowed: false,
				reason: "shell_operator_detected",
				detectedOperator: dangerousChar.operator,
			}
		}

		// Parse the command into segments recursively
		const parseResult = this.parseCommandSegments(command)
		if (!parseResult) {
			// Parsing failed - be conservative and block
			return {
				allowed: false,
				reason: "shell_operator_detected",
				detectedOperator: "parse_error",
			}
		}

		// Validate the parsed command structure
		const result = this.validateParsedCommand(parseResult, command)
		return result
	}

	/**
	 * Recursively validate a parsed command structure
	 * @param parsed - The parsed command with segments and subshells
	 * @param fullCommand - The full original command (for error messages)
	 * @returns PermissionValidationResult
	 */
	private validateParsedCommand(parsed: ParsedCommand, fullCommand: string): PermissionValidationResult {
		// Check if redirects are allowed
		if (parsed.hasRedirects && !this.config?.allowRedirects) {
			return {
				allowed: false,
				reason: "redirect_detected",
			}
		}

		// Validate each command segment
		const isMultiSegment = parsed.segments.length > 1 || parsed.subshells.length > 0
		for (const segment of parsed.segments) {
			const result = this.validateSingleCommand(segment)
			if (!result.allowed) {
				// Only use segment-specific reasons for multi-segment commands
				if (isMultiSegment) {
					return {
						...result,
						failedSegment: segment,
						reason:
							result.reason === "denied"
								? "segment_denied"
								: result.reason === "no_match_deny_default"
									? "segment_no_match"
									: result.reason,
					}
				}
				return result
			}
		}

		// Recursively validate subshell contents
		for (const subshell of parsed.subshells) {
			const result = this.validateParsedCommand(subshell, fullCommand)
			if (!result.allowed) {
				return result
			}
		}

		return { allowed: true, reason: "allowed" }
	}

	/**
	 * Validate a single command (no operators) against allow/deny rules.
	 *
	 * @param command - A single command without shell operators
	 * @returns PermissionValidationResult for this command
	 */
	private validateSingleCommand(command: string): PermissionValidationResult {
		// Check deny rules first (deny takes precedence)
		if (this.config?.deny) {
			for (const pattern of this.config.deny) {
				if (this.matchesPattern(command, pattern)) {
					return { allowed: false, matchedPattern: pattern, reason: "denied" }
				}
			}
		}

		// Check allow rules
		if (this.config?.allow && this.config.allow.length > 0) {
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

	private parseCommandSegments(input: string): ParsedCommand {
		let tokens: ParseEntry[] = []
		try {
			tokens = parse(input)
		} catch (err) {
			Logger.error("Error parsing command: " + err.message)
			return { segments: [], subshells: [], hasRedirects: false }
		}

		function process(tokenList: ParseEntry[]): ParsedCommand {
			const result: ParsedCommand = {
				segments: [],
				subshells: [],
				hasRedirects: false,
			}

			let currentSegmentParts: string[] = []

			const flushSegment = () => {
				if (currentSegmentParts.length > 0) {
					result.segments.push(currentSegmentParts.join(" "))
					currentSegmentParts = []
				}
			}

			for (let i = 0; i < tokenList.length; i++) {
				const token = tokenList[i]

				// 1. Handle Subshells: ( ... )
				if (typeof token === "object" && "op" in token && token.op === "(") {
					flushSegment()

					let balance = 1
					let j = i + 1
					const subTokens: ParseEntry[] = []

					while (j < tokenList.length && balance > 0) {
						const subToken = tokenList[j]
						if (typeof subToken === "object" && "op" in subToken) {
							if (subToken.op === "(") {
								balance++
							}
							if (subToken.op === ")") {
								balance--
							}
						}

						if (balance > 0) {
							subTokens.push(subToken)
						}
						j++
					}

					result.subshells.push(process(subTokens))
					i = j - 1 // Skip processed tokens
					continue
				}

				// 2. Handle Logic Separators: &&, ||, ;, |
				if (typeof token === "object" && "op" in token && COMMAND_SEPARATOR_OPERATORS.has(token.op as string)) {
					flushSegment()
					continue
				}

				// 3. Handle Redirect Operators: >, >>, <, etc.
				if (typeof token === "object" && "op" in token && REDIRECT_OPERATORS.has(token.op as string)) {
					result.hasRedirects = true
					continue
				}

				// 4. Handle Strings (Commands and Arguments)
				if (typeof token === "string") {
					// Preserve the '$' for subshell interpolation $(...) in the segment
					// so that "echo $(whoami)" becomes segment "echo $" which matches "echo *"
					const nextToken = tokenList[i + 1]
					if (token === "$" && typeof nextToken === "object" && "op" in nextToken && nextToken.op === "(") {
						currentSegmentParts.push(token)
						continue
					}
					currentSegmentParts.push(token)
				}
				// 5. Handle Glob/Pattern objects
				else if (typeof token === "object" && "pattern" in token) {
					currentSegmentParts.push(token.pattern)
				}
			}

			flushSegment()
			return result
		}

		return process(tokens)
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
}
