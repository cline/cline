/**
 * Configuration structure for command permissions from environment variable
 */
export interface CommandPermissionConfig {
	allow?: string[] // Glob patterns for allowed commands
	deny?: string[] // Glob patterns for denied commands
	allowRedirects?: boolean // Whether to allow shell redirects (>, >>, <, etc.) - defaults to false
}

/**
 * Result of a permission validation check
 */
export interface PermissionValidationResult {
	allowed: boolean
	matchedPattern?: string // The pattern that matched (for error messages)
	reason:
		| "no_config"
		| "allowed"
		| "denied"
		| "no_match_deny_default"
		| "shell_operator_detected"
		| "redirect_detected" // Redirect operators (>, >>, <) were used but not allowed
		| "segment_denied" // A segment in a chained command matched a deny pattern
		| "segment_no_match" // A segment in a chained command didn't match any allow pattern
	detectedOperator?: string // The shell operator that was detected (for error messages)
	failedSegment?: string // The command segment that failed validation (for chained commands)
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
