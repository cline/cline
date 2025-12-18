/**
 * Shared timestamp formatting utilities used across different logging contexts.
 * This ensures consistent timestamp formats in logs across VS Code, CLI, and standalone modes.
 */

/**
 * Formats a date into the timestamp format used in log filenames.
 * Format: YYYY-MM-DDTHH-mm-ss (UTC)
 * Example: 2025-01-15T14-30-45
 */
export function formatLogFilenameTimestamp(date: Date = new Date()): string {
	// Use ISO format and replace colons with dashes for filename compatibility
	return date.toISOString().replace(/:/g, "-").split(".")[0]
}

/**
 * Formats a date into the timestamp format used in log messages.
 * Format: YYYY-MM-DDTHH:mm:ss.SSSZ (UTC)
 * Example: 2025-01-15T14:30:45.123Z
 */
export function formatLogMessageTimestamp(date: Date = new Date()): string {
	return date.toISOString()
}
