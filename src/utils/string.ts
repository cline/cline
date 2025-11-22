/**
 * Fixes incorrectly escaped HTML entities in AI model outputs
 * @param text String potentially containing incorrectly escaped HTML entities from AI models
 * @returns String with HTML entities converted back to normal characters
 */
export function fixModelHtmlEscaping(text: string): string {
	return text
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&apos;/g, "'")
}

/**
 * Removes invalid characters (like the replacement character �) from a string
 * @param text String potentially containing invalid characters
 * @returns String with invalid characters removed
 */
export function removeInvalidChars(text: string): string {
	return text.replace(/\uFFFD/g, "")
}

/**
 * Fixes over-escaped JSON strings in terminal commands
 * Some AI models over-escape quotes in command parameters, leading to commands like:
 * echo \"test\" instead of echo "test"
 * This function unescapes common JSON escape sequences that shouldn't be in shell commands
 * @param text Command string potentially containing over-escaped characters
 * @returns Command with proper escaping for shell execution
 */
export function fixCommandEscaping(text: string): string {
	// Unescape JSON-style escaped quotes and backslashes
	// This handles cases where models output \" instead of "
	return text
		.replace(/\\"/g, '"')     // \" → "
		.replace(/\\'/g, "'")     // \' → '
		.replace(/\\\\/g, "\\")   // \\ → \ (but do this last to avoid double-processing)
}
