/**
 * Utilities for handling path-related operations in mentions
 */

/**
 * Converts an absolute path to a mention-friendly path
 * If the provided path starts with the current working directory,
 * it's converted to a relative path prefixed with @
 *
 * @param path The path to convert
 * @param cwd The current working directory
 * @returns A mention-friendly path
 */
export function convertToMentionPath(path: string, cwd?: string): string {
	const normalizedPath = path.replace(/\\/g, "/")
	let normalizedCwd = cwd ? cwd.replace(/\\/g, "/") : ""

	if (!normalizedCwd) {
		return path
	}

	// Remove trailing slash from cwd if it exists
	if (normalizedCwd.endsWith("/")) {
		normalizedCwd = normalizedCwd.slice(0, -1)
	}

	// Always use case-insensitive comparison for path matching
	const lowerPath = normalizedPath.toLowerCase()
	const lowerCwd = normalizedCwd.toLowerCase()

	if (lowerPath.startsWith(lowerCwd)) {
		const relativePath = normalizedPath.substring(normalizedCwd.length)
		// Ensure there's a slash after the @ symbol when we create the mention path
		return "@" + (relativePath.startsWith("/") ? relativePath : "/" + relativePath)
	}

	return path
}
