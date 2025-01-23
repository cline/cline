import { promises as fs } from "fs"
import * as path from "path"

interface IgnorePattern {
	pattern: string
	isNegated: boolean
}

export class IgnoreParser {
	private patterns: IgnorePattern[] = []

	/**
	 * Load and parse a .clineignore file
	 * @param dirPath Directory path to look for .clineignore file
	 */
	async loadIgnoreFile(dirPath: string): Promise<void> {
		const ignorePath = path.join(dirPath, ".clineignore")
		try {
			const content = await fs.readFile(ignorePath, "utf8")
			this.parsePatterns(content)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error
			}
			// File doesn't exist - that's okay, just use default patterns
		}
	}

	/**
	 * Parse ignore patterns from file content
	 * @param content Raw content of .clineignore file
	 */
	private parsePatterns(content: string): void {
		const lines = content.split("\n")

		for (const line of lines) {
			const trimmed = line.trim()

			// Skip empty lines and comments
			if (!trimmed || trimmed.startsWith("#")) {
				continue
			}

			this.patterns.push({
				pattern: trimmed,
				isNegated: trimmed.startsWith("!"),
			})
		}
	}

	/**
	 * Convert .clineignore pattern to globby-compatible pattern
	 */
	private normalizePattern(pattern: string): string {
		// Remove leading and trailing slashes
		let normalized = pattern.replace(/^\/+|\/+$/g, "")

		// Handle patterns that should match files in any directory
		if (!normalized.startsWith("**/") && !normalized.startsWith("/")) {
			normalized = `**/${normalized}`
		}

		// Detect if this is a directory pattern
		const isDirectoryPattern =
			normalized.endsWith("/") || // Explicit directory pattern
			(!normalized.includes(".") && !normalized.includes("*")) || // No extension or wildcards
			/^[\w-]+$/.test(normalized.split("/").pop() || "") // Simple name without special chars

		// Handle directory patterns
		if (isDirectoryPattern) {
			normalized = normalized.replace(/\/?$/, "/**")
		}

		// Handle file patterns
		const isFilePattern = normalized.includes(".") || normalized.includes("*")
		if (isFilePattern && !isDirectoryPattern) {
			// Don't add /** to file patterns
			normalized = normalized.replace(/\/\*\*$/, "")
		}

		return normalized
	}

	/**
	 * Get all ignore patterns including negations
	 */
	getIgnorePatterns(): string[] {
		return this.patterns.map(({ pattern, isNegated }) => {
			if (isNegated) {
				const cleanPattern = pattern.slice(1)
				return `!${this.normalizePattern(cleanPattern)}`
			}
			return this.normalizePattern(pattern)
		})
	}

	/**
	 * Clear all loaded patterns
	 */
	clear(): void {
		this.patterns = []
	}
}

// Singleton instance for reuse
export const ignoreParser = new IgnoreParser()
