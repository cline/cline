import { fileExistsAtPath } from "./fs"
import * as path from "path"
import * as fs from "fs/promises"

/**
 * Loads the contents of .clineignore file and returns cache and evaluation function.
 * @param cwd Current working directory
 * @returns Object containing patterns and evaluation function
 */
function parseIgnorePatterns(clineIgnoreFile: string): string[] {
	return clineIgnoreFile
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
}

export async function loadIgnorePatterns(cwd: string): Promise<{
	patterns: string[]
	shouldIgnore: (path: string) => boolean
}> {
	const ignoreContent = await loadClineIgnoreFile(cwd)
	const patterns = parseIgnorePatterns(ignoreContent)
	return {
		patterns,
		shouldIgnore: (path: string) => shouldIgnorePath(path, ignoreContent),
	}
}

/**
 * Filters multiple file paths in batch.
 * @param paths Array of paths to filter
 * @param ignoreContent Contents of .clineignore file
 * @returns Array of filtered paths
 */
export function filterIgnoredPaths(paths: string[], ignoreContent: string): string[] {
	return paths.filter((path) => !shouldIgnorePath(path, ignoreContent))
}

export async function loadClineIgnoreFile(cwd: string): Promise<string> {
	const filePath = path.join(cwd, ".clineignore")
	try {
		const fileExists = await fileExistsAtPath(filePath)
		if (!fileExists) {
			return ""
		}
		return fs.readFile(filePath, "utf-8")
	} catch (error) {
		return ""
	}
}

function convertGlobToRegExp(pattern: string): string {
	// Handle directory pattern
	if (pattern.endsWith("/")) {
		pattern = pattern + "**"
	}

	return (
		pattern
			// Escape special characters
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			// Convert wildcard * to regex pattern
			.replace(/\*/g, ".*")
	)
}

export function shouldIgnorePath(filePath: string, clineIgnoreFile: string): boolean {
	const patterns = parseIgnorePatterns(clineIgnoreFile)
	let isIgnored = false

	// Evaluate patterns in order
	for (const pattern of patterns) {
		const isNegation = pattern.startsWith("!")
		const actualPattern = isNegation ? pattern.slice(1) : pattern

		// Convert pattern to regex
		const regexPattern = convertGlobToRegExp(actualPattern)
		const regex = new RegExp(`^${regexPattern}$`)

		// Check if pattern matches
		if (regex.test(filePath)) {
			isIgnored = !isNegation
		}
	}

	return isIgnored
}
