import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import ignore, { Ignore } from "ignore"
import * as vscode from "vscode"

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .clineignore files.
 */
export class LLMFileAccessController {
	private cwd: string
	private ignoreInstance: Ignore
	private fileWatcher: vscode.FileSystemWatcher | null
	private disposables: vscode.Disposable[] = []

	/**
	 * Default patterns that are always ignored for security
	 */
	private static readonly DEFAULT_PATTERNS = [] // empty for now

	constructor(cwd: string) {
		this.cwd = cwd
		this.ignoreInstance = ignore()
		this.ignoreInstance.add(LLMFileAccessController.DEFAULT_PATTERNS)
		this.fileWatcher = null

		// Set up file watcher for .clineignore
		this.setupFileWatcher()
	}

	/**
	 * Initialize the controller by loading custom patterns
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		await this.loadCustomPatterns()
	}

	/**
	 * Set up the file watcher for .clineignore changes
	 */
	private setupFileWatcher(): void {
		const clineignorePattern = new vscode.RelativePattern(this.cwd, ".clineignore")
		this.fileWatcher = vscode.workspace.createFileSystemWatcher(clineignorePattern)

		// Watch for changes and updates
		this.disposables.push(
			this.fileWatcher.onDidChange(() => {
				this.loadCustomPatterns().catch((error) => {
					console.error("Failed to load updated .clineignore patterns:", error)
				})
			}),
			this.fileWatcher.onDidCreate(() => {
				this.loadCustomPatterns().catch((error) => {
					console.error("Failed to load new .clineignore patterns:", error)
				})
			}),
			this.fileWatcher.onDidDelete(() => {
				this.resetToDefaultPatterns()
			}),
		)

		// Add fileWatcher itself to disposables
		this.disposables.push(this.fileWatcher)
	}

	/**
	 * Load custom patterns from .clineignore if it exists
	 */
	private async loadCustomPatterns(): Promise<void> {
		try {
			const ignorePath = path.join(this.cwd, ".clineignore")
			if (await fileExistsAtPath(ignorePath)) {
				// Reset ignore instance to prevent duplicate patterns
				this.resetToDefaultPatterns()
				const content = await fs.readFile(ignorePath, "utf8")
				const customPatterns = content
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line && !line.startsWith("#"))

				this.ignoreInstance.add(customPatterns)
			}
		} catch (error) {
			// Continue with default patterns
		}
	}

	/**
	 * Reset ignore patterns to defaults
	 */
	private resetToDefaultPatterns(): void {
		this.ignoreInstance = ignore()
		this.ignoreInstance.add(LLMFileAccessController.DEFAULT_PATTERNS)
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

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.fileWatcher = null
	}
}
