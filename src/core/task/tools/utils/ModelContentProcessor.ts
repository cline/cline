import { fixCommandEscaping, fixModelHtmlEscaping, removeInvalidChars } from "@utils/string"

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

/**
 * Applies model-specific fixes to terminal commands.
 * Handles over-escaped quotes and backslashes that some models produce.
 *
 * @param command The command string to process
 * @param modelId The model ID to check if fixes are needed (optional - if not provided, applies fixes)
 * @returns The processed command
 */
export function applyModelCommandFixes(command: string, modelId?: string): string {
	if (modelId?.includes("claude")) {
		return command
	}

	// Fix JSON-style escaping that shouldn't be in shell commands
	let processed = fixCommandEscaping(command)

	// Also fix HTML escaping (some models might use &quot; etc.)
	processed = fixModelHtmlEscaping(processed)

	// Remove invalid characters
	processed = removeInvalidChars(processed)

	return processed
}
