import { fixModelHtmlEscaping, removeInvalidChars } from "@utils/string"

/**
 * File extensions that use escaped characters (&lt; &gt; &amp;) as valid syntax.
 * Add more extensions as needed (e.g., ".svg", ".xsd", ".xslt")
 */
const ESCAPED_CHARACTER_EXTENSIONS = [".xml"] as const

/**
 * Applies model-specific content fixes to handle quirks from non-Claude models.
 * Fixes escaped character issues and removes invalid characters.
 * Files using escaped characters as syntax (e.g., XML) are exempted from fixing.
 *
 * @param text The content to process
 * @param modelId The model ID to check if fixes are needed (optional - if not provided, applies fixes)
 * @param filePath The file path to determine if it uses escaped characters (optional)
 * @returns The processed content
 */
export function applyModelContentFixes(text: string, modelId?: string, filePath?: string): string {
	if (modelId?.includes("claude")) {
		return text
	}

	const usesEscapedCharacters = ESCAPED_CHARACTER_EXTENSIONS.some((ext) => filePath?.toLowerCase().endsWith(ext))

	let processed = text

	if (!usesEscapedCharacters) {
		processed = fixModelHtmlEscaping(processed)
	}

	processed = removeInvalidChars(processed)

	return processed
}
