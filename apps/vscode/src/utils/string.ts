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
 * Removes terminal/control characters that can poison provider-bound prompts while preserving
 * normal whitespace used for readable file and command output.
 */
export function sanitizeTextForModelInput(text: string): string {
	return text
		.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
}
