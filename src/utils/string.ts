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
 * Sanitizes a string to be safely included in JSON.
 * Handles known problematic characters and ensures basic UTF-8 validity.
 * @param text String to sanitize
 * @returns Sanitized string
 */
export function sanitizeStringForJSON(text: string): string {
	if (typeof text !== "string") {
		return text
	}

	// Replace specific problematic characters
	let sanitizedText = text.replace(/×/g, "x") // Replace multiplication sign often found in npm errors

	// Remove Unicode replacement character � (often indicates encoding issues)
	sanitizedText = sanitizedText.replace(/\uFFFD/g, "")

	// Attempt to filter out invalid UTF-8 sequences.
	// This is a basic approach; more complex scenarios might need a dedicated library.
	sanitizedText = Buffer.from(sanitizedText, "utf8").toString("utf8")

	// Add any other specific character replacements or removals here if needed

	return sanitizedText
}
