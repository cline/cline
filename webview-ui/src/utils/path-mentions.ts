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
	// Strip file:// or vscode-remote:// protocol if present
	let pathWithoutProtocol = path

	if (path.startsWith("file://")) {
		pathWithoutProtocol = path.substring(7)
	} else if (path.startsWith("vscode-remote://")) {
		const protocolStripped = path.substring("vscode-remote://".length)
		const firstSlashIndex = protocolStripped.indexOf("/")
		if (firstSlashIndex !== -1) {
			pathWithoutProtocol = protocolStripped.substring(firstSlashIndex + 1)
		} else {
			pathWithoutProtocol = ""
		}
	}

	try {
		pathWithoutProtocol = decodeURIComponent(pathWithoutProtocol)
		// Fix: Remove leading slash for Windows paths like /d:/...
		if (pathWithoutProtocol.startsWith("/") && pathWithoutProtocol[2] === ":") {
			pathWithoutProtocol = pathWithoutProtocol.substring(1)
		}
	} catch (e) {
		// Log error if decoding fails, but continue with the potentially problematic path
		console.error("Error decoding URI component in convertToMentionPath:", e, pathWithoutProtocol)
	}

	const normalizedPath = pathWithoutProtocol.replace(/\\/g, "/")
	let normalizedCwd = cwd ? cwd.replace(/\\/g, "/") : ""

	if (!normalizedCwd) {
		return pathWithoutProtocol
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

	return pathWithoutProtocol
}
