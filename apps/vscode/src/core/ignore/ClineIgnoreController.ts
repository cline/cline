import { fileExistsAtPath } from "@utils/fs"
import chokidar, { FSWatcher } from "chokidar"
import fs from "fs/promises"
import ignore, { Ignore } from "ignore"
import os from "os"
import path from "path"
import { Logger } from "@/shared/services/Logger"

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

export interface ClineIgnoreOptions {
	/** Enable sandboxed execution mode and sensitive file protections. */
	sandboxMode?: boolean
	/** Restrict file operations strictly to workspace cwd (except essential system runtimes). */
	strictContainment?: boolean
	/** Additional sensitive patterns or paths to deny. */
	blockedSensitivePatterns?: string[]
}

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .clineignore files.
 */
export class ClineIgnoreController {
	private cwd: string
	private ignoreInstance: Ignore
	private fileWatcher?: FSWatcher
	clineIgnoreContent: string | undefined
	private sandboxMode: boolean = false
	private strictContainment: boolean = false
	private customBlockedPatterns: string[] = []

	constructor(cwd: string, options?: ClineIgnoreOptions) {
		this.cwd = cwd
		this.ignoreInstance = ignore()
		this.clineIgnoreContent = undefined
		if (options) {
			this.sandboxMode = !!options.sandboxMode
			this.strictContainment = !!options.strictContainment
			this.customBlockedPatterns = options.blockedSensitivePatterns || []
		}
	}

	setSandboxMode(enabled: boolean, strictContainment: boolean = false): void {
		this.sandboxMode = enabled
		this.strictContainment = strictContainment
	}

	isSandboxMode(): boolean {
		return this.sandboxMode
	}

	isStrictContainment(): boolean {
		return this.strictContainment
	}

	/**
	 * Initialize the controller by loading custom patterns and setting up file watcher
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		// Set up file watcher for .clineignore
		this.setupFileWatcher()
		await this.loadClineIgnore()
	}

	/**
	 * Set up the file watcher for .clineignore changes
	 */
	private setupFileWatcher(): void {
		const ignorePath = path.join(this.cwd, ".clineignore")

		this.fileWatcher = chokidar.watch(ignorePath, {
			persistent: true, // Keep the process running as long as files are being watched
			ignoreInitial: true, // Don't fire 'add' events when discovering the file initially
			awaitWriteFinish: {
				// Wait for writes to finish before emitting events (handles chunked writes)
				stabilityThreshold: 100, // Wait 100ms for file size to remain constant
				pollInterval: 100, // Check file size every 100ms while waiting for stability
			},
			atomic: true, // Handle atomic writes where editors write to a temp file then rename
		})

		// Watch for file changes, creation, and deletion
		this.fileWatcher.on("change", () => {
			this.loadClineIgnore()
		})

		this.fileWatcher.on("add", () => {
			this.loadClineIgnore()
		})

		this.fileWatcher.on("unlink", () => {
			this.loadClineIgnore()
		})

		this.fileWatcher.on("error", (error) => {
			Logger.error("Error watching .clineignore file:", error)
		})
	}

	/**
	 * Load custom patterns from .clineignore if it exists.
	 * Supports "!include <filename>" to load additional ignore patterns from other files.
	 */
	private async loadClineIgnore(): Promise<void> {
		try {
			// Reset ignore instance to prevent duplicate patterns
			this.ignoreInstance = ignore()
			const ignorePath = path.join(this.cwd, ".clineignore")
			if (await fileExistsAtPath(ignorePath)) {
				const content = await fs.readFile(ignorePath, "utf8")
				this.clineIgnoreContent = content
				await this.processIgnoreContent(content)
				this.ignoreInstance.add(".clineignore")
			} else {
				this.clineIgnoreContent = undefined
			}
		} catch (error) {
			// Should never happen: reading file failed even though it exists
			Logger.error("Unexpected error loading .clineignore:", error)
		}
	}

	/**
	 * Process ignore content and apply all ignore patterns
	 */
	private async processIgnoreContent(content: string): Promise<void> {
		// Optimization: first check if there are any !include directives
		if (!content.includes("!include ")) {
			this.ignoreInstance.add(content)
			return
		}

		// Process !include directives
		const combinedContent = await this.processClineIgnoreIncludes(content)
		this.ignoreInstance.add(combinedContent)
	}

	/**
	 * Process !include directives and combine all included file contents
	 */
	private async processClineIgnoreIncludes(content: string): Promise<string> {
		let combinedContent = ""
		const lines = content.split(/\r?\n/)

		for (const line of lines) {
			const trimmedLine = line.trim()

			if (!trimmedLine.startsWith("!include ")) {
				combinedContent += "\n" + line
				continue
			}

			// Process !include directive
			const includedContent = await this.readIncludedFile(trimmedLine)
			if (includedContent) {
				combinedContent += "\n" + includedContent
			}
		}

		return combinedContent
	}

	/**
	 * Read content from an included file specified by !include directive
	 */
	private async readIncludedFile(includeLine: string): Promise<string | null> {
		const includePath = includeLine.substring("!include ".length).trim()
		const resolvedIncludePath = path.join(this.cwd, includePath)

		if (!(await fileExistsAtPath(resolvedIncludePath))) {
			Logger.debug(`[ClineIgnore] Included file not found: ${resolvedIncludePath}`)
			return null
		}

		return await fs.readFile(resolvedIncludePath, "utf8")
	}

	/**
	 * Checks if a path targets sensitive credentials, tokens, or system secrets.
	 *
	 * @param filePath - Path to inspect (relative or absolute)
	 * @returns true if the path targets a sensitive file/directory
	 */
	isSensitivePath(filePath: string): boolean {
		if (!filePath || typeof filePath !== "string") {
			return false
		}

		const homedir = os.homedir()
		let resolvedPath: string
		if (filePath.startsWith("~")) {
			resolvedPath = path.join(homedir, filePath.slice(1))
		} else {
			resolvedPath = path.resolve(this.cwd, filePath)
		}

		const normalized = resolvedPath.replace(/\\/g, "/").toLowerCase()
		const basename = path.basename(resolvedPath).toLowerCase()

		// 1. Sensitive environment files (.env, .env.* except .env.example / .sample / .template)
		if (
			basename === ".env" ||
			(basename.startsWith(".env.") &&
				!basename.endsWith(".example") &&
				!basename.endsWith(".sample") &&
				!basename.endsWith(".template"))
		) {
			return true
		}

		// 2. Private cryptographic keys, certs, and keystores
		const sensitiveExtensions = [".pem", ".key", ".pfx", ".p12", ".pkcs12"]
		if (sensitiveExtensions.some((ext) => basename.endsWith(ext))) {
			return true
		}
		const sensitiveKeyNames = ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"]
		if (sensitiveKeyNames.some((k) => basename === k || basename === `${k}.pub`)) {
			return true
		}

		// 3. User credential directories in home directory
		const normalizedHome = homedir.replace(/\\/g, "/").toLowerCase()
		const sensitiveHomeDirs = [
			"/.ssh",
			"/.aws",
			"/.gnupg",
			"/.azure",
			"/.kube",
			"/.config/gcloud",
		]
		for (const dir of sensitiveHomeDirs) {
			const targetDir = `${normalizedHome}${dir}`
			if (normalized === targetDir || normalized.startsWith(`${targetDir}/`)) {
				return true
			}
		}

		// 4. Sensitive credential and history files in home directory
		const sensitiveHomeFiles = [
			"/.git-credentials",
			"/.netrc",
			"/.docker/config.json",
			"/.bash_history",
			"/.zsh_history",
		]
		for (const file of sensitiveHomeFiles) {
			const targetFile = `${normalizedHome}${file}`
			if (normalized === targetFile) {
				return true
			}
		}

		// 5. System secret files
		const systemSecrets = ["/etc/shadow", "/etc/sudoers", "/etc/master.passwd"]
		if (systemSecrets.some((sec) => normalized === sec || normalized.startsWith(`${sec}/`))) {
			return true
		}

		// 6. Custom blocked patterns if configured
		for (const pattern of this.customBlockedPatterns) {
			if (normalized.includes(pattern.toLowerCase())) {
				return true
			}
		}

		return false
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * @param filePath - Path to check (relative to cwd or absolute)
	 * @returns true if file is accessible, false if ignored or sensitive
	 */
	validateAccess(filePath: string): boolean {
		const absolutePath = filePath.startsWith("~")
			? path.join(os.homedir(), filePath.slice(1))
			: path.resolve(this.cwd, filePath)

		// Fail-closed protection for sensitive files in sandbox mode or if .clineignore is present
		if (this.sandboxMode || this.clineIgnoreContent) {
			if (this.isSensitivePath(absolutePath)) {
				return false
			}
		}

		// Strict containment: block access to paths outside cwd (except essential system runtimes)
		if (this.sandboxMode && this.strictContainment) {
			const relative = path.relative(this.cwd, absolutePath)
			const isOutside = relative.startsWith("..") || path.isAbsolute(relative)
			if (isOutside) {
				const posixAbs = absolutePath.replace(/\\/g, "/")
				const allowedPrefixes = ["/usr", "/bin", "/lib", "/lib64", "/opt", "/etc/ssl", "/etc/resolv.conf"]
				const isAllowedSystem = allowedPrefixes.some((p) => posixAbs === p || posixAbs.startsWith(`${p}/`))
				if (!isAllowedSystem) {
					return false
				}
			}
		}

		// Always allow access if .clineignore does not exist and not blocked by sensitive checks above
		if (!this.clineIgnoreContent) {
			return true
		}

		try {
			// Normalize path to be relative to cwd and use forward slashes
			const relativePath = path.relative(this.cwd, absolutePath).toPosix()

			// Ignore expects paths to be path.relative()'d
			return !this.ignoreInstance.ignores(relativePath)
		} catch (_error) {
			// Ignore is designed to work with relative file paths, so throws error for paths outside cwd.
			// In sandbox mode, never allow sensitive paths outside cwd.
			if (this.sandboxMode && this.isSensitivePath(absolutePath)) {
				return false
			}
			return true
		}
	}

	/**
	 * Check if a terminal command should be allowed to execute based on file access patterns
	 * and destructive out-of-tree modifications.
	 *
	 * @param command - Terminal command to validate
	 * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
	 */
	validateCommand(command: string): string | undefined {
		// Always allow if neither .clineignore nor sandboxMode exists
		if (!this.clineIgnoreContent && !this.sandboxMode) {
			return undefined
		}

		// Check for inline interpreters or subshells reading/executing sensitive commands
		// e.g. python3 -c "print(open('.env').read())" or sh -c "cat .env"
		const interpreterMatch = command.match(/\b(?:python|python3|node|perl|ruby|bash|sh|zsh)\s+(?:-c|-e)\s+["']([^"']+)["']/i)
		if (interpreterMatch && interpreterMatch[1]) {
			const innerResult = this.validateCommand(interpreterMatch[1])
			if (innerResult) {
				return innerResult
			}
		}

		// Split compound commands by &&, ||, ;, and |
		const subCommands = command.split(/&&|\|\||;|\|/)

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
			"curl",
			"wget",
			// PowerShell commands and aliases
			"get-content",
			"gc",
			"type",
			"select-string",
			"sls",
		]

		// Commands that delete or destroy files
		const destructiveCommands = [
			// Unix commands
			"rm",
			"rmdir",
			"unlink",
			"shred",
			"truncate",
			"dd",
			// PowerShell commands and aliases
			"remove-item",
			"ri",
			"del",
			"erase",
			"rd",
		]

		for (const subCmd of subCommands) {
			const trimmed = subCmd.trim()
			if (!trimmed) continue

			const parts = trimmed.split(/\s+/)
			const baseCommand = parts[0].toLowerCase()

			// Check destructive commands
			if (destructiveCommands.includes(baseCommand)) {
				for (let i = 1; i < parts.length; i++) {
					const arg = parts[i]
					// Skip command flags (e.g. -f, -rf, --recursive, or Windows single-character switches /y)
					if (arg.startsWith("-") || (process.platform === "win32" && /^\/[a-zA-Z?]$/.test(arg))) {
						continue
					}
					// Root and home destruction protection: rm -rf / or rm -rf ~ or rm -rf ..
					const cleanArg = arg.replace(/^["']|["']$/g, "")
					if (
						cleanArg === "/" ||
						cleanArg === "/*" ||
						cleanArg === "~" ||
						cleanArg === "~/*" ||
						cleanArg === "$HOME" ||
						cleanArg === "%USERPROFILE%" ||
						cleanArg.startsWith("/etc") ||
						cleanArg.startsWith("/var") ||
						cleanArg.startsWith("/usr") ||
						cleanArg.startsWith("/boot")
					) {
						return cleanArg
					}
					if (cleanArg === ".." || cleanArg.startsWith("../") || cleanArg.startsWith("..\\")) {
						return cleanArg
					}
					// Check if deleting a sensitive file (e.g. rm .env, rm -rf ~/.ssh)
					if (this.isSensitivePath(cleanArg)) {
						return cleanArg
					}
				}
			}

			// Check file reading commands
			if (fileReadingCommands.includes(baseCommand)) {
				for (let i = 1; i < parts.length; i++) {
					const arg = parts[i]
					// Skip command flags (e.g. -n, -v, or Windows single-character switches /s)
					if (arg.startsWith("-") || (process.platform === "win32" && /^\/[a-zA-Z?]$/.test(arg))) {
						continue
					}
					// Ignore PowerShell parameter names (e.g. -Path:foo), but keep Windows drive letters (C:\)
					if (arg.includes(":") && !arg.startsWith("C:") && !arg.startsWith("c:") && !arg.startsWith("D:") && !arg.startsWith("d:")) {
						continue
					}
					const cleanArg = arg.replace(/^["']|["']$/g, "")
					// Validate file access: checks ignore patterns, sensitive paths, and containment
					if (!this.validateAccess(cleanArg)) {
						return cleanArg
					}
				}
			}

			// If in sandbox mode, check arguments of ANY command for sensitive targets (.env, ~/.ssh, etc.)
			if (this.sandboxMode) {
				for (let i = 1; i < parts.length; i++) {
					const cleanArg = parts[i].replace(/^["']|["']$/g, "")
					if (cleanArg.startsWith("-")) continue
					if (this.isSensitivePath(cleanArg)) {
						return cleanArg
					}
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
		try {
			return paths
				.map((p) => ({
					path: p,
					allowed: this.validateAccess(p),
				}))
				.filter((x) => x.allowed)
				.map((x) => x.path)
		} catch (error) {
			Logger.error("Error filtering paths:", error)
			return [] // Fail closed for security
		}
	}

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	async dispose(): Promise<void> {
		if (this.fileWatcher) {
			await this.fileWatcher.close()
			this.fileWatcher = undefined
		}
	}
}
