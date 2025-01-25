import * as path from "path"
import * as fs from "fs/promises"
import { globby } from "globby"

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
        duration: 0
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
     * Validates configuration thresholds and ensures required arrays exist
     * @throws Error if thresholds exceed maximum allowed values
     */
    private validateConfig(): void {
        // Validate thresholds
        if (this.config.thresholds?.maxFileSize && this.config.thresholds.maxFileSize > 1_073_741_824) {
            throw new Error("Max file size cannot exceed 1GB")
        }
        if (this.config.thresholds?.maxCheckpointSize && this.config.thresholds.maxCheckpointSize > 10_737_418_240) {
            throw new Error("Max checkpoint size cannot exceed 10GB")
        }

        // Validate arrays are present
        this.config.ignore = this.config.ignore || []
        this.config.tracking = this.config.tracking || {}
        this.config.tracking.excludeTypes = this.config.tracking.excludeTypes || []
        this.config.tracking.excludeDirs = this.config.tracking.excludeDirs || []
    }

    /**
     * Loads configuration from .checkpointrules or .clinerules file
     * Falls back to default configuration if no config files exist
     */
    private async loadConfig(): Promise<void> {
        try {
            // Try loading .checkpointrules first
            const checkpointConfigPath = path.join(this.cwd, ".checkpointrules")
            try {
                const content = await fs.readFile(checkpointConfigPath, "utf-8")
                this.config = JSON.parse(content)
                return
            } catch (checkpointError) {
                // If .checkpointrules doesn't exist, try .clinerules for backward compatibility
                const clineruleConfigPath = path.join(this.cwd, ".clinerules")
                try {
                    const content = await fs.readFile(clineruleConfigPath, "utf-8")
                    this.config = JSON.parse(content)
                    console.log("Warning: Using deprecated .clinerules file. Please migrate to .checkpointrules")
                    return
                } catch (clineruleError) {
                    // Neither file exists - use defaults
                    throw new Error("No configuration file found")
                }
            }
        } catch (error) {
            // No config files exist or are invalid - use defaults
            this.config = {
                thresholds: {
                    maxFileSize: 10 * 1024 * 1024, // 10MB
                    maxCheckpointSize: 10 * 1024 * 1024 * 1024, // 10GB
                },
                tracking: {
                    excludeTypes: [".jpg", ".jpeg", ".png", ".gif", ".mp4", ".mov", ".dat"],
                    excludeDirs: ["node_modules", "vendor", "dist", "build"]
                }
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
            const excludedDir = this.config.tracking?.excludeDirs?.some(excluded =>
                dir === excluded || dir.startsWith(excluded + path.sep)
            )
            if (excludedDir) {
                this.stats.excludedFiles++
                return false
            }

            // Check custom ignore patterns
            // Convert ignore patterns to globby format (e.g., "*.dat" -> "**/*.dat")
            const ignorePatterns = this.config.ignore?.map(pattern => {
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
                    ignore: ignorePatterns
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
     * Checks if a file's size is within configured thresholds
     * @param filePath Path to the file to check
     * @returns Promise<boolean> True if file size is within limits
     */
    private async checkFileSize(filePath: string): Promise<boolean> {
        try {
            // Check if file exists first
            try {
                await fs.access(filePath)
            } catch {
                return false
            }

            const stats = await fs.stat(filePath)
            const maxSize = this.config.thresholds?.maxFileSize ?? Infinity
            return stats.size <= maxSize
        } catch (error) {
            if (error instanceof Error) {
                if ('code' in error && error.code === 'ENOENT') {
                    // File was deleted, remove from tracking
                    this.accessedFiles.delete(filePath)
                    this.modifiedFiles.delete(filePath)
                }
                console.warn(`Failed to check file size for ${filePath}:`, error.message)
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
        const absolutePath = path.resolve(this.cwd, filePath)

        // Skip if file shouldn't be tracked based on rules
        if (!(await this.shouldTrackFile(absolutePath))) {
            return
        }

        // Skip if file is too large
        if (!(await this.checkFileSize(absolutePath))) {
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
    }

    /**
     * Returns a list of all files that have been accessed
     * @returns Array of relative paths to accessed files
     */
    getAccessedFiles(): string[] {
        return Array.from(this.accessedFiles).map(file =>
            path.relative(this.cwd, file)
        )
    }

    /**
     * Returns a list of all files that have been modified
     * @returns Array of relative paths to modified files
     */
    getModifiedFiles(): string[] {
        return Array.from(this.modifiedFiles).map(file =>
            path.relative(this.cwd, file)
        )
    }

    /**
     * Calculates the total size of all tracked files
     * @returns Promise<number> Total size in bytes
     */
    async getTotalTrackedSize(): Promise<number> {
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
                    if ('code' in error && error.code === 'ENOENT') {
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
            startTime: Date.now()
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
            startTime: undefined
        }
    }
}
