import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import ignore, { Ignore } from "ignore"
import * as vscode from "vscode"

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .clineignore files.
 */
export class ClineIgnoreController {
	private cwd: string
	private ignoreInstance: Ignore
	private disposables: vscode.Disposable[] = []
	private clineIgnoreContent: string | undefined
	private gitIgnoreContent: string | undefined
	private initialized: boolean = false
	private initPromise: Promise<void> | null = null

	constructor(cwd: string) {
		this.cwd = cwd
		this.ignoreInstance = ignore()
		this.clineIgnoreContent = undefined
		this.gitIgnoreContent = undefined
		// Set up file watcher for .clineignore and .gitignore
		this.setupFileWatcher()
	}

	/**
	 * Get the content of the ignore files for external use
	 * @returns An object containing the content of .clineignore and .gitignore files
	 */
	getIgnoreContent(): { clineIgnore?: string; gitIgnore?: string } {
		return {
			clineIgnore: this.clineIgnoreContent,
			gitIgnore: this.gitIgnoreContent,
		}
	}

	/**
	 * Initialize the controller by loading custom patterns
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		if (this.initPromise) {
			return this.initPromise
		}

		this.initPromise = this._initialize()
		return this.initPromise
	}

	private async _initialize(): Promise<void> {
		try {
			await Promise.all([this.loadClineIgnore(), this.loadGitIgnore()])
			this.initialized = true
		} catch (error) {
			console.error("Error initializing ClineIgnoreController:", error)
			// Still mark as initialized to prevent hanging
			this.initialized = true
		}
	}

	/**
	 * Set up the file watcher for .clineignore and .gitignore changes
	 */
	private setupFileWatcher(): void {
		// Watch for .clineignore changes
		const clineignorePattern = new vscode.RelativePattern(this.cwd, ".clineignore")
		const clineignoreWatcher = vscode.workspace.createFileSystemWatcher(clineignorePattern)

		// Watch for .gitignore changes
		const gitignorePattern = new vscode.RelativePattern(this.cwd, ".gitignore")
		const gitignoreWatcher = vscode.workspace.createFileSystemWatcher(gitignorePattern)

		// Watch for changes and updates to .clineignore
		this.disposables.push(
			clineignoreWatcher.onDidChange(() => {
				this.loadClineIgnore()
			}),
			clineignoreWatcher.onDidCreate(() => {
				this.loadClineIgnore()
			}),
			clineignoreWatcher.onDidDelete(() => {
				this.loadClineIgnore()
			}),
		)

		// Watch for changes and updates to .gitignore
		this.disposables.push(
			gitignoreWatcher.onDidChange(() => {
				this.loadGitIgnore()
			}),
			gitignoreWatcher.onDidCreate(() => {
				this.loadGitIgnore()
			}),
			gitignoreWatcher.onDidDelete(() => {
				this.loadGitIgnore()
			}),
		)

		// Add fileWatchers to disposables
		this.disposables.push(clineignoreWatcher, gitignoreWatcher)
	}

	/**
	 * Load custom patterns from .clineignore if it exists
	 */
	private async loadClineIgnore(): Promise<void> {
		try {
			// Reset ignore instance to prevent duplicate patterns
			this.ignoreInstance = ignore()

			// First load .gitignore if it exists
			if (this.gitIgnoreContent) {
				this.ignoreInstance.add(this.gitIgnoreContent)
			}

			const ignorePath = path.join(this.cwd, ".clineignore")
			if (await fileExistsAtPath(ignorePath)) {
				const content = await fs.readFile(ignorePath, "utf8")
				this.clineIgnoreContent = content
				this.ignoreInstance.add(content)
				// Always ignore the .clineignore file itself
				this.ignoreInstance.add(".clineignore")
			} else {
				this.clineIgnoreContent = undefined
				// If no .clineignore but we have .gitignore, we need to re-add .clineignore to the ignore list
				if (this.gitIgnoreContent) {
					this.ignoreInstance.add(".clineignore")
				}
			}
		} catch (error) {
			// Should never happen: reading file failed even though it exists
			console.error("Unexpected error loading .clineignore:", error)
		}
	}

	/**
	 * Load patterns from .gitignore if it exists
	 */
	private async loadGitIgnore(): Promise<void> {
		try {
			const gitIgnorePath = path.join(this.cwd, ".gitignore")
			if (await fileExistsAtPath(gitIgnorePath)) {
				const content = await fs.readFile(gitIgnorePath, "utf8")
				this.gitIgnoreContent = content

				// Reload .clineignore to ensure proper order of patterns
				await this.loadClineIgnore()
			} else {
				this.gitIgnoreContent = undefined
				// If .gitignore was deleted, we need to reload just .clineignore
				if (this.clineIgnoreContent) {
					this.ignoreInstance = ignore()
					this.ignoreInstance.add(this.clineIgnoreContent)
					this.ignoreInstance.add(".clineignore")
				}
			}
		} catch (error) {
			console.error("Unexpected error loading .gitignore:", error)
		}
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is accessible, false if ignored
	 */
	validateAccess(filePath: string): boolean {
		// Ensure controller is initialized
		if (!this.initialized) {
			console.warn("ClineIgnoreController.validateAccess called before initialization completed")
			return true
		}

		// Always allow access if neither .clineignore nor .gitignore exist
		if (!this.clineIgnoreContent && !this.gitIgnoreContent) {
			return true
		}

		try {
			// Handle null or undefined paths
			if (!filePath) {
				return true
			}

			// Normalize path to be relative to cwd and use forward slashes
			const absolutePath = path.resolve(this.cwd, filePath)

			// Check if the path is outside the workspace
			if (!absolutePath.startsWith(this.cwd)) {
				// For security, we should not allow access to files outside the workspace
				// This is a change from the previous behavior
				return false
			}

			// Get the path relative to cwd
			let relativePath = path.relative(this.cwd, absolutePath)

			// Convert to posix style for consistent handling across platforms
			relativePath = relativePath.split(path.sep).join("/")

			// Ignore expects paths to be path.relative()'d
			return !this.ignoreInstance.ignores(relativePath)
		} catch (error) {
			console.error(`Error validating access for ${filePath}:`, error)
			// For security, fail closed (deny access) on errors
			return false
		}
	}

	/**
	 * Check if a terminal command should be allowed to execute based on file access patterns
	 * @param command - Terminal command to validate
	 * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
	 */
	validateCommand(command: string): string | undefined {
		// Always allow if no ignore files exist
		if (!this.clineIgnoreContent && !this.gitIgnoreContent) {
			return undefined
		}

		// Handle empty commands
		if (!command || !command.trim()) {
			return undefined
		}

		// Split command into parts and get the base command
		const parts = command.trim().split(/\s+/)
		const baseCommand = parts[0].toLowerCase()

		// Commands that read file contents
		const fileReadingCommands = [
			// Unix commands
			"cat",
			"less",
			"more",
			"head",
			"tail",
			"grep",
			"awk",
			"sed",
			// PowerShell commands and aliases
			"get-content",
			"gc",
			"type",
			"select-string",
			"sls",
		]

		if (fileReadingCommands.includes(baseCommand)) {
			// Check each argument that could be a file path
			for (let i = 1; i < parts.length; i++) {
				const arg = parts[i]
				// Skip command flags/options (both Unix and PowerShell style)
				if (arg.startsWith("-") || arg.startsWith("/")) {
					continue
				}
				// Ignore PowerShell parameter names
				if (arg.includes(":")) {
					continue
				}
				// Validate file access
				if (!this.validateAccess(arg)) {
					return arg
				}
			}
		}

		return undefined
	}

	/**
	 * Filter an array of paths, removing those that should be ignored
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Array of allowed paths
	 */
	filterPaths(paths: string[]): string[] {
		if (!paths || !Array.isArray(paths)) {
			return []
		}

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
	}
}
