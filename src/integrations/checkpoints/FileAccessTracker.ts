import * as path from "path"
import * as fs from "fs/promises"
import { globby } from "globby"
import { fileExistsAtPath } from "../../utils/fs"

interface CheckpointRuleConfig {
	ignore?: string[]
	thresholds?: {
		maxFileSize?: number
		maxCheckpointSize?: number
	}
	tracking?: {
		excludeTypes?: string[]
		excludeDirs?: string[]
	}
}

export interface CheckpointStats {
	totalFiles: number
	excludedFiles: number
	checkpointSize: number
	duration: number
	startTime?: number
}

/**
 * Tracks file access and modifications while respecting configured rules and thresholds.
 * Provides functionality to monitor file operations and maintain statistics about tracked files.
 */
export class FileAccessTracker {
	private accessedFiles: Set<string> = new Set()
	private modifiedFiles: Set<string> = new Set()
	private config: CheckpointRuleConfig = {}
	private cwd: string
	private stats: CheckpointStats = {
		totalFiles: 0,
		excludedFiles: 0,
		checkpointSize: 0,
		duration: 0,
	}

	/**
	 * Creates a new FileAccessTracker instance
	 * @param cwd The current working directory to track files in
	 */
	constructor(cwd: string) {
		this.cwd = cwd
		this.stats.startTime = Date.now()
	}

	/**
	 * Initializes the tracker by loading and validating configuration
	 * Must be called before using the tracker
	 */
	public async initialize(): Promise<void> {
		await this.loadConfig()
		await this.validateConfig()
	}

	/**
	 * Ensures required arrays exist in configuration
	 */
	private validateConfig(): void {
		// Initialize arrays
		this.config.ignore = this.config.ignore || []
		this.config.tracking = this.config.tracking || {}
		this.config.tracking.excludeTypes = this.config.tracking.excludeTypes || []
		this.config.tracking.excludeDirs = this.config.tracking.excludeDirs || []

		// Initialize thresholds if they exist in config
		if (this.config.thresholds?.maxFileSize || this.config.thresholds?.maxCheckpointSize) {
			this.config.thresholds = this.config.thresholds || {}
		}
	}

	/**
	 * Formats a file size in bytes to a human readable string
	 * @param bytes Size in bytes
	 * @returns Formatted string (e.g., "1.5 MB")
	 */
	private formatSize(bytes?: number): string {
		if (bytes === undefined) return "unknown"
		const units = ["B", "KB", "MB", "GB"]
		let size = bytes
		let unitIndex = 0
		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024
			unitIndex++
		}
		return `${size.toFixed(1)} ${units[unitIndex]}`
	}

	/**
	 * Checks if a file's size is within configured thresholds
	 * @param filePath Path to the file to check
	 * @returns Promise with result and size information
	 */
	private async checkFileSize(filePath: string): Promise<{ isWithinLimit: boolean; size?: number }> {
		// If no thresholds set, allow all files
		if (!this.config.thresholds?.maxFileSize) {
			return { isWithinLimit: true }
		}

		try {
			// Check if file exists first
			try {
				await fs.access(filePath)
			} catch {
				return { isWithinLimit: false }
			}

			const stats = await fs.stat(filePath)
			return {
				isWithinLimit: stats.size <= this.config.thresholds.maxFileSize,
				size: stats.size,
			}
		} catch (error) {
			if (error instanceof Error) {
				if ("code" in error && error.code === "ENOENT") {
					// File was deleted, remove from tracking
					this.accessedFiles.delete(filePath)
					this.modifiedFiles.delete(filePath)
				}
				console.warn(`Failed to check file size for ${filePath}:`, error.message)
			}
			return { isWithinLimit: false }
		}
	}

	/**
	 * Loads configuration from .checkpointrules file
	 * Falls back to default configuration if the file doesn't exist
	 */
	private async loadConfig(): Promise<void> {
		// Get LFS patterns from workspace if they exist
		let lfsPatterns: string[] = []
		try {
			const attributesPath = path.join(this.cwd, ".gitattributes")
			if (await fileExistsAtPath(attributesPath)) {
				const attributesContent = await fs.readFile(attributesPath, "utf8")
				lfsPatterns = attributesContent
					.split("\n")
					.filter((line) => line.includes("filter=lfs"))
					.map((line) => line.split(" ")[0].trim())
			}
		} catch (error) {
			console.warn("Failed to read .gitattributes:", error)
		}

		try {
			// Try loading .checkpointrules
			const checkpointConfigPath = path.join(this.cwd, ".checkpointrules")
			const content = await fs.readFile(checkpointConfigPath, "utf-8")
			this.config = JSON.parse(content)

			// Add LFS patterns to ignore list if they exist
			if (lfsPatterns.length > 0) {
				this.config.ignore = [...(this.config.ignore || []), ...lfsPatterns]
			}
			return
		} catch (error) {
			// No .checkpointrules file exists or is invalid - use defaults
			this.config = {
				ignore: [
					// Git files
					".git/",
					".git_disabled/",
					".git*_disabled/", // Handle any git disabled suffix variations
					// Add LFS patterns if they exist
					...lfsPatterns,
				],
				tracking: {
					excludeTypes: [
						// Media files
						".jpg",
						".jpeg",
						".png",
						".gif",
						".bmp",
						".ico",
						".mp3",
						".mp4",
						".wav",
						".avi",
						".mov",
						".wmv",
						".webm",
						".webp",
						".m4a",
						".flac",
						// Cache and temporary files
						".cache",
						".tmp",
						".temp",
						".swp",
						".swo",
						".pyc",
						".pyo",
						// Environment and config files
						".env",
						".local",
						".development",
						".production",
						// Large data files
						".zip",
						".tar",
						".gz",
						".rar",
						".7z",
						".iso",
						".bin",
						".exe",
						".dll",
						".so",
						".dylib",
						// Database files
						".sqlite",
						".db",
						".sql",
						// Log files
						".log",
						".logs",
						".error",
						// Debug logs
						"npm-debug.log",
						"yarn-debug.log",
						"yarn-error.log",
						// System files
						".DS_Store",
					],
					excludeDirs: [
						// Version control
						".git",
						// Package managers and dependencies
						"node_modules",
						"vendor",
						"deps",
						"pkg",
						"Pods",
						// Build outputs
						"dist",
						"out",
						"bundle",
						"build",
						"target/dependency",
						"build/dependencies",
						// Virtual environments
						"env",
						"venv",
						"__pycache__",
						// IDE and editor
						".gradle",
						".idea",
						".vscode",
						".vs",
						// Test and coverage
						"coverage",
						".pytest_cache",
						// Next.js
						".next",
						".nuxt",
						// Temporary
						"tmp",
						"temp",
						"bin",
						"obj",
					],
				},
			}
		}
	}

	/**
	 * Determines if a file should be tracked based on configured rules
	 * @param filePath Path to the file to check
	 * @returns Promise<boolean> True if file should be tracked
	 */
	private async shouldTrackFile(filePath: string): Promise<boolean> {
		try {
			// Safety check: verify file exists
			try {
				await fs.access(filePath)
			} catch {
				return false
			}

			const relativePath = path.relative(this.cwd, filePath)

			// Check file extension against excluded types
			const ext = path.extname(filePath)
			if (this.config.tracking?.excludeTypes?.includes(ext)) {
				this.stats.excludedFiles++
				return false
			}

			// Check directory against excluded dirs
			const dir = path.dirname(relativePath)
			const excludedDir = this.config.tracking?.excludeDirs?.some(
				(excluded) => dir === excluded || dir.startsWith(excluded + path.sep),
			)
			if (excludedDir) {
				this.stats.excludedFiles++
				return false
			}

			// Check custom ignore patterns
			// Convert ignore patterns to globby format (e.g., "*.dat" -> "**/*.dat")
			const ignorePatterns = this.config.ignore?.map((pattern) => {
				// If pattern doesn't start with * or **, make it match anywhere in path
				if (!pattern.startsWith("*")) {
					return `**/${pattern}`
				}
				return pattern
			})

			try {
				// Use globby to check if file matches any ignore pattern
				const matches = await globby(relativePath, {
					cwd: this.cwd,
					dot: true,
					ignore: ignorePatterns,
				})

				if (matches.length > 0) {
					this.stats.excludedFiles++
					return false
				}

				return true
			} catch (error) {
				if (error instanceof Error) {
					console.warn(`Failed to check ignore patterns for ${filePath}:`, error.message)
				}
				return false
			}
		} catch (error) {
			if (error instanceof Error) {
				console.warn(`Failed to check if file should be tracked ${filePath}:`, error.message)
			}
			return false
		}
	}

	/**
	 * Tracks a file access operation while respecting configured rules and thresholds
	 * @param filePath Path to the file being accessed
	 * @param operation Type of operation ("read" or "write")
	 */
	async trackFileAccess(filePath: string, operation: "read" | "write"): Promise<void> {
		try {
			const absolutePath = path.resolve(this.cwd, filePath)

			// Skip if file shouldn't be tracked based on rules
			if (!(await this.shouldTrackFile(absolutePath))) {
				return
			}

			// Check file size
			const sizeCheck = await this.checkFileSize(absolutePath)
			if (!sizeCheck.isWithinLimit) {
				this.stats.excludedFiles++
				const limit = this.config.thresholds?.maxFileSize
				console.warn(
					`FileAccessTracker: File exceeds size limit: ${path.relative(this.cwd, absolutePath)} ` +
						`(${this.formatSize(sizeCheck.size)} > ${this.formatSize(limit)})`,
				)
				return
			}

			const isNewFile = !this.accessedFiles.has(absolutePath)
			this.accessedFiles.add(absolutePath)

			if (operation === "write") {
				const isNewModifiedFile = !this.modifiedFiles.has(absolutePath)
				this.modifiedFiles.add(absolutePath)
				if (isNewModifiedFile) {
					console.log(`FileAccessTracker: File marked as modified: ${path.relative(this.cwd, absolutePath)}`)
				}
			}

			this.stats.totalFiles = this.accessedFiles.size
			if (isNewFile) {
				console.log(`FileAccessTracker: New file tracked: ${path.relative(this.cwd, absolutePath)}`)
			}
		} catch (error) {
			// Log error but don't throw since tracking is non-critical
			if (error instanceof Error) {
				console.warn(`FileAccessTracker: Failed to track file access for ${filePath}:`, error.message)
			}
		}
	}

	/**
	 * Returns a list of all files that have been accessed
	 * @returns Array of relative paths to accessed files
	 */
	getAccessedFiles(): string[] {
		return Array.from(this.accessedFiles).map((file) => path.relative(this.cwd, file))
	}

	/**
	 * Returns a list of all files that have been modified
	 * @returns Array of relative paths to modified files
	 */
	getModifiedFiles(): string[] {
		return Array.from(this.modifiedFiles).map((file) => path.relative(this.cwd, file))
	}

	/**
	 * Calculates the total size of all tracked files
	 * @returns Promise<number> Total size in bytes
	 */
	/**
	 * Checks if total tracked size exceeds configured maxCheckpointSize
	 * @returns Promise<boolean> True if size is within limit or no limit set
	 */
	async checkTotalSize(): Promise<boolean> {
		// If no threshold set, allow all sizes
		if (!this.config.thresholds?.maxCheckpointSize) {
			return true
		}

		const totalSize = await this.getTotalTrackedSize()
		return totalSize <= this.config.thresholds.maxCheckpointSize
	}

	/**
	 * Calculates the total size of all tracked files
	 * @returns Promise<number> Total size in bytes
	 */
	private async getTotalTrackedSize(): Promise<number> {
		let totalSize = 0
		const deletedFiles = new Set<string>()

		for (const file of this.accessedFiles) {
			try {
				// Check if file exists first
				try {
					await fs.access(file)
				} catch {
					deletedFiles.add(file)
					continue
				}

				const stats = await fs.stat(file)
				totalSize += stats.size
			} catch (error) {
				if (error instanceof Error) {
					if ("code" in error && error.code === "ENOENT") {
						// File was deleted
						deletedFiles.add(file)
					}
					console.warn(`Failed to get size for ${file}:`, error.message)
				}
			}
		}

		// Clean up deleted files
		for (const file of deletedFiles) {
			this.accessedFiles.delete(file)
			this.modifiedFiles.delete(file)
		}

		this.stats.checkpointSize = totalSize
		return totalSize
	}

	getStats(): CheckpointStats {
		if (this.stats.startTime) {
			this.stats.duration = Date.now() - this.stats.startTime
		}
		return { ...this.stats }
	}

	/**
	 * Clears all tracked files and resets statistics
	 */
	clear(): void {
		this.accessedFiles.clear()
		this.modifiedFiles.clear()
		this.stats = {
			totalFiles: 0,
			excludedFiles: 0,
			checkpointSize: 0,
			duration: 0,
			startTime: Date.now(),
		}
	}

	/**
	 * Cleans up resources used by the tracker
	 */
	dispose(): void {
		this.accessedFiles.clear()
		this.modifiedFiles.clear()
		this.stats = {
			totalFiles: 0,
			excludedFiles: 0,
			checkpointSize: 0,
			duration: 0,
			startTime: undefined,
		}
	}
}
