import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import ignore, { Ignore } from "ignore"

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .clineignore files.
 */
export class LLMFileAccessController {
	private cwd: string
	private ignoreInstance: Ignore

	/**
	 * Default patterns that are always ignored for security
	 */
	private static readonly DEFAULT_PATTERNS = [
		"**/.env*", // Environment files
		"**/.git/**", // Git directory
		"**/node_modules/**", // Dependencies
		"**/.vscode/**", // VSCode settings
		"**/.idea/**", // IntelliJ settings
		"**/.DS_Store", // macOS files
		"**/dist/**", // Build output
		"**/build/**", // Build output
		"**/coverage/**", // Test coverage
		"**/*.log", // Log files
		"**/*.key", // Key files
		"**/*.pem", // Certificate files
		"**/*.pfx", // Certificate files
		"**/id_rsa*", // SSH keys
		"**/id_ed25519*", // SSH keys
		"**/id_ecdsa*", // SSH keys
		"**/*.p12", // Certificate files
		"**/*.jks", // Java keystore files
		"**/secrets.*", // Secret files
		"**/credentials.*", // Credential files
		"**/__pycache__/**", // Python bytecode cache
		"**/env/**", // Python virtual environment
		"**/venv/**", // Virtual environment
		"**/target/dependency/**", // Dependency folder in Java/Maven projects
		"**/out/**", // Output directories (common in various build systems)
		"**/bundle/**", // Bundled files for deployment
		"**/vendor/**", // Vendor dependencies (used in PHP, Go, etc.)
		"**/tmp/**", // Temporary files
		"**/temp/**", // Temporary files
		"**/deps/**", // Dependencies folder (various ecosystems)
		"**/pkg/**", // Package files (common in Go, Rust, etc.)
		"**/Pods/**", // CocoaPods dependencies (iOS/macOS development)
		"**/build/dependencies/**", // Dependencies within build folders
		"**/.*", // Hidden directories
	]

	constructor(cwd: string) {
		this.cwd = cwd
		this.ignoreInstance = ignore()

		// Add default patterns immediately
		this.ignoreInstance.add(LLMFileAccessController.DEFAULT_PATTERNS)
	}

	/**
	 * Initialize the controller by loading custom patterns
	 * This must be called and awaited before using the controller
	 */
	async initialize(): Promise<void> {
		await this.loadCustomPatterns()
	}

	/**
	 * Load custom patterns from .clineignore if it exists
	 */
	private async loadCustomPatterns(): Promise<void> {
		try {
			const ignorePath = path.join(this.cwd, ".clineignore")
			if (await fileExistsAtPath(ignorePath)) {
				const content = await fs.readFile(ignorePath, "utf8")
				const customPatterns = content
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line && !line.startsWith("#"))

				this.ignoreInstance.add(customPatterns)
			}
		} catch (error) {
			console.error("Failed to load .clineignore:", error)
			// Continue with default patterns
		}
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is accessible, false if ignored
	 */
	validateAccess(filePath: string): boolean {
		try {
			// Normalize path to be relative to cwd and use forward slashes
			const absolutePath = path.resolve(this.cwd, filePath)
			const relativePath = path.relative(this.cwd, absolutePath).replace(/\\/g, "/")

			// Block access to paths outside cwd (those starting with '..')
			if (relativePath.startsWith("..")) {
				return false
			}

			// Use ignore library to check if path should be ignored
			return !this.ignoreInstance.ignores(relativePath)
		} catch (error) {
			console.error(`Error validating access for ${filePath}:`, error)
			return false // Fail closed for security
		}
	}

	/**
	 * Filter an array of paths, removing those that should be ignored
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Array of allowed paths
	 */
	filterPaths(paths: string[]): string[] {
		try {
			return paths
				.map((p) => ({
					path: p,
					allowed: this.validateAccess(p),
				}))
				.filter((x) => x.allowed)
				.map((x) => x.path)
		} catch (error) {
			console.error("Error filtering paths:", error)
			return [] // Fail closed for security
		}
	}
}
