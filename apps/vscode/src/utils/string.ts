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

const ANSI_SEQUENCE_TERMINATOR = "(?:\\u0007|\\u001B\\u005C|\\u009C)"
const ANSI_ESCAPE_PATTERN = new RegExp(
	[
		`[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?${ANSI_SEQUENCE_TERMINATOR})`,
		"(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
	].join("|"),
	"g",
)

/**
 * Removes terminal/control characters that can poison provider-bound prompts while preserving
 * normal whitespace used for readable file and command output.
 */
export function sanitizeTextForModelInput(text: string): string {
	return text.replace(ANSI_ESCAPE_PATTERN, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
}
