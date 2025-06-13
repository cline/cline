import path from "path"
import ignore, { Ignore } from "ignore"

export const SHIELD_SYMBOL = "\u{1F6E1}"

/**
 * Controls write access to Roo configuration files by enforcing protection patterns.
 * Prevents auto-approved modifications to sensitive Roo configuration files.
 */
export class RooProtectedController {
	private cwd: string
	private ignoreInstance: Ignore

	// Predefined list of protected Roo configuration patterns
	private static readonly PROTECTED_PATTERNS = [
		".rooignore",
		".roomodes",
		".roorules*",
		".clinerules*",
		".roo/**",
		".rooprotected", // For future use
	]

	constructor(cwd: string) {
		this.cwd = cwd
		// Initialize ignore instance with protected patterns
		this.ignoreInstance = ignore()
		this.ignoreInstance.add(RooProtectedController.PROTECTED_PATTERNS)
	}

	/**
	 * Check if a file is write-protected
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is write-protected, false otherwise
	 */
	isWriteProtected(filePath: string): boolean {
		try {
			// Normalize path to be relative to cwd and use forward slashes
			const absolutePath = path.resolve(this.cwd, filePath)
			const relativePath = path.relative(this.cwd, absolutePath).toPosix()

			// Use ignore library to check if file matches any protected pattern
			return this.ignoreInstance.ignores(relativePath)
		} catch (error) {
			// If there's an error processing the path, err on the side of caution
			// Ignore is designed to work with relative file paths, so will throw error for paths outside cwd
			console.error(`Error checking protection for ${filePath}:`, error)
			return false
		}
	}

	/**
	 * Get set of write-protected files from a list
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Set of protected file paths
	 */
	getProtectedFiles(paths: string[]): Set<string> {
		const protectedFiles = new Set<string>()

		for (const filePath of paths) {
			if (this.isWriteProtected(filePath)) {
				protectedFiles.add(filePath)
			}
		}

		return protectedFiles
	}

	/**
	 * Filter an array of paths, marking which ones are protected
	 * @param paths - Array of paths to check (relative to cwd)
	 * @returns Array of objects with path and protection status
	 */
	annotatePathsWithProtection(paths: string[]): Array<{ path: string; isProtected: boolean }> {
		return paths.map((filePath) => ({
			path: filePath,
			isProtected: this.isWriteProtected(filePath),
		}))
	}

	/**
	 * Get display message for protected file operations
	 */
	getProtectionMessage(): string {
		return "This is a Roo configuration file and requires approval for modifications"
	}

	/**
	 * Get formatted instructions about protected files for the LLM
	 * @returns Formatted instructions about file protection
	 */
	getInstructions(): string {
		const patterns = RooProtectedController.PROTECTED_PATTERNS.join(", ")
		return `# Protected Files\n\n(The following Roo configuration file patterns are write-protected and always require approval for modifications, regardless of autoapproval settings. When using list_files, you'll notice a ${SHIELD_SYMBOL} next to files that are write-protected.)\n\nProtected patterns: ${patterns}`
	}

	/**
	 * Get the list of protected patterns (for testing/debugging)
	 */
	static getProtectedPatterns(): readonly string[] {
		return RooProtectedController.PROTECTED_PATTERNS
	}
}
