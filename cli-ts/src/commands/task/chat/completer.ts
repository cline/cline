/**
 * Tab completion for @ file/folder mentions in chat REPL
 *
 * Provides file and folder path completion when users type @ followed by a partial path.
 */

import fs from "fs"
import path from "path"

/**
 * Result of finding an @ mention to complete
 */
interface AtMentionMatch {
	/** The text before the @ mention (to preserve in completion) */
	prefix: string
	/** The partial path after @ that needs completion */
	partial: string
	/** Character index where the @ starts */
	atIndex: number
}

/**
 * Find the @ mention being completed in the input line
 *
 * Handles multiple @ mentions by finding the last one that appears
 * to be incomplete (user is still typing it).
 */
function findAtMentionToComplete(line: string): AtMentionMatch | null {
	// Find the last @ that could be a file mention
	// We look for @ that's either at start or preceded by whitespace
	let atIndex = -1
	for (let i = line.length - 1; i >= 0; i--) {
		if (line[i] === "@") {
			// Check if it's at start or preceded by whitespace
			if (i === 0 || /\s/.test(line[i - 1])) {
				atIndex = i
				break
			}
		}
	}

	if (atIndex === -1) {
		return null
	}

	// Extract the partial path after @
	const afterAt = line.slice(atIndex + 1)

	// If there's whitespace after @, this mention is complete, not being typed
	if (/\s/.test(afterAt)) {
		return null
	}

	return {
		prefix: line.slice(0, atIndex),
		partial: afterAt,
		atIndex,
	}
}

/**
 * Get completions for a partial file/folder path
 */
function getPathCompletions(partial: string, cwd: string): string[] {
	try {
		// Determine the directory to search and the prefix to match
		let searchDir: string
		let namePrefix: string

		if (partial === "") {
			// Empty partial - list cwd contents
			searchDir = cwd
			namePrefix = ""
		} else if (partial.endsWith("/")) {
			// Ends with / - list that directory's contents
			searchDir = path.resolve(cwd, partial)
			namePrefix = ""
		} else {
			// Partial filename - list parent directory and filter
			const partialPath = path.resolve(cwd, partial)
			searchDir = path.dirname(partialPath)
			namePrefix = path.basename(partial)
		}

		// Check if directory exists
		if (!fs.existsSync(searchDir) || !fs.statSync(searchDir).isDirectory()) {
			return []
		}

		// Read directory contents
		const entries = fs.readdirSync(searchDir, { withFileTypes: true })

		// Filter and map entries
		const completions: string[] = []
		for (const entry of entries) {
			// Skip hidden files unless explicitly searching for them
			if (entry.name.startsWith(".") && !namePrefix.startsWith(".")) {
				continue
			}

			// Check if name matches prefix
			if (!entry.name.toLowerCase().startsWith(namePrefix.toLowerCase())) {
				continue
			}

			// Build the completion path
			let completionPath: string
			if (partial === "") {
				completionPath = entry.name
			} else if (partial.endsWith("/")) {
				completionPath = partial + entry.name
			} else {
				// Replace the partial filename with the full name
				const dirPart = partial.slice(0, partial.length - namePrefix.length)
				completionPath = dirPart + entry.name
			}

			// Append / for directories
			if (entry.isDirectory()) {
				completionPath += "/"
			}

			completions.push(completionPath)
		}

		// Sort: directories first, then alphabetically
		completions.sort((a, b) => {
			const aIsDir = a.endsWith("/")
			const bIsDir = b.endsWith("/")
			if (aIsDir && !bIsDir) return -1
			if (!aIsDir && bIsDir) return 1
			return a.localeCompare(b)
		})

		return completions
	} catch {
		// If anything goes wrong, return no completions
		return []
	}
}

/**
 * Create a readline completer function for @ file mentions
 *
 * @param cwd - The current working directory for path resolution
 * @returns A completer function compatible with readline
 */
export function createCompleter(cwd: string): (line: string) => [string[], string] {
	return (line: string): [string[], string] => {
		const match = findAtMentionToComplete(line)

		if (!match) {
			// No @ mention being typed - no completions
			return [[], line]
		}

		const pathCompletions = getPathCompletions(match.partial, cwd)

		if (pathCompletions.length === 0) {
			return [[], line]
		}

		// Build full line completions (prefix + @ + completed path)
		const fullCompletions = pathCompletions.map((p) => `${match.prefix}@${p}`)

		// The "substring" is what readline uses to determine what to replace
		// We want to replace from the @ onwards
		const substring = `@${match.partial}`

		// Return format: [completions, substring being completed]
		// If there's only one completion, readline will auto-complete
		// If multiple, it will show them as options
		return [fullCompletions, line]
	}
}

// Export for testing
export { findAtMentionToComplete, getPathCompletions }
