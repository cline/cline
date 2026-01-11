/**
 * Configuration structure for command permissions from environment variable
 */
export interface CommandPermissionConfig {
	allow?: string[] // Glob patterns for allowed commands
	deny?: string[] // Glob patterns for denied commands
	allowOperators?: string[] // Shell operators to allow (e.g., [">", ">>"] to allow file writing)
}

/**
 * Result of a permission validation check
 */
export interface PermissionValidationResult {
	allowed: boolean
	matchedPattern?: string // The pattern that matched (for error messages)
	reason: "no_config" | "allowed" | "denied" | "no_match_deny_default" | "shell_operator_detected"
	detectedOperator?: string // The shell operator that was detected (for error messages)
}

/**
 * Environment variable name for command permissions
 */
export const COMMAND_PERMISSIONS_ENV_VAR = "CLINE_COMMAND_PERMISSIONS"

/**
 * Shell operators that indicate command chaining, piping, substitution, or redirection.
 * These are security-sensitive because they can be used to bypass command restrictions.
 */
export interface ShellOperatorMatch {
	operator: string
	description: string
}
