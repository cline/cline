/**
 * Shared timestamp formatting utilities used across different logging contexts.
 * This ensures consistent timestamp formats in logs across VS Code, CLI, and standalone modes.
 */

/**
 * Formats a date into the timestamp format used in log filenames.
 * Format: YYYY-MM-DD-HH-mm-ss
 * Example: 2025-01-15-14-30-45
 */
export function formatLogFilenameTimestamp(date: Date = new Date()): string {
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
		String(date.getHours()).padStart(2, "0"),
		String(date.getMinutes()).padStart(2, "0"),
		String(date.getSeconds()).padStart(2, "0"),
	].join("-")
}

/**
 * Formats a date into the timestamp format used in log messages.
 * Format: YYYY-MM-DDTHH:mm:ss.SSS
 * Example: 2025-01-15T14:30:45.123
 */
export function formatLogMessageTimestamp(date: Date = new Date()): string {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, "0")
	const day = String(date.getDate()).padStart(2, "0")
	const hours = String(date.getHours()).padStart(2, "0")
	const minutes = String(date.getMinutes()).padStart(2, "0")
	const seconds = String(date.getSeconds()).padStart(2, "0")
	const milliseconds = String(date.getMilliseconds()).padStart(3, "0")

	return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`
}
