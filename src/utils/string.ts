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
 * Determines if a model's output should be fixed for HTML escaping issues
 * @param model Model object containing the model ID
 * @returns Boolean indicating if the model's output should be fixed
 */
export function shouldFixModelHtmlEscaping(model: { id: string }): boolean {
	const id = model.id.toLowerCase()
	return !(id.includes("claude") || id.includes("gemini-2."))
}
