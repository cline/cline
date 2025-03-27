/**
 * Utilities for handling path-related operations in mentions
 */

import { formatPath } from "../../../src/shared/formatPath"

/**
 * Converts an absolute path to a mention-friendly path
 * If the provided path starts with the current working directory,
 * it's converted to a relative path prefixed with @
 *
 * @param path The path to convert
 * @param cwd The current working directory
 * @returns A mention-friendly path
 */
export function convertToMentionPath(path: string, cwd?: string, os?: string): string {
	const normalizedPath = formatPath(path, os)
	let normalizedCwd = cwd ? formatPath(cwd, os) : ""

	if (!normalizedCwd) {
		return path
	}

	// Remove trailing slash from cwd if it exists
	if ((os !== "win32" && normalizedCwd.endsWith("/")) || (os === "win32" && normalizedCwd.endsWith("\\"))) {
		normalizedCwd = normalizedCwd.slice(0, -1)
	}

	// Always use case-insensitive comparison for path matching
	const lowerPath = normalizedPath.toLowerCase()
	const lowerCwd = normalizedCwd.toLowerCase()

	if (lowerPath.startsWith(lowerCwd)) {
		const relativePath = normalizedPath.substring(normalizedCwd.length)
		// Ensure there's a slash after the @ symbol when we create the mention path
		return "@" + formatPath(relativePath, os, false)
	}

	return path
}
