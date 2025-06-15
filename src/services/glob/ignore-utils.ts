import { DIRS_TO_IGNORE } from "./constants"

/**
 * Checks if a file path should be ignored based on the DIRS_TO_IGNORE patterns.
 * This function handles special patterns like ".*" for hidden directories.
 *
 * @param filePath The file path to check
 * @returns true if the path should be ignored, false otherwise
 */
export function isPathInIgnoredDirectory(filePath: string): boolean {
	// Normalize path separators
	const normalizedPath = filePath.replace(/\\/g, "/")
	const pathParts = normalizedPath.split("/")

	// Check each directory in the path against DIRS_TO_IGNORE
	for (const part of pathParts) {
		// Skip empty parts (from leading or trailing slashes)
		if (!part) continue

		// Handle the ".*" pattern for hidden directories
		if (DIRS_TO_IGNORE.includes(".*") && part.startsWith(".") && part !== ".") {
			return true
		}

		// Check for exact matches
		if (DIRS_TO_IGNORE.includes(part)) {
			return true
		}
	}

	// Check if path contains any ignored directory pattern
	for (const dir of DIRS_TO_IGNORE) {
		if (dir === ".*") {
			// Already handled above
			continue
		}

		// Check if the directory appears in the path
		if (normalizedPath.includes(`/${dir}/`)) {
			return true
		}
	}

	return false
}
