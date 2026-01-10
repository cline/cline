/**
 * ClineTempManager - Manages temporary files for Cline with automatic cleanup.
 *
 * Simple approach:
 * - Uses system temp directory directly (no subdirectory)
 * - All Cline temp files use "cline-" prefix for identification
 * - Cleans up files older than 50 hours on extension activation
 * - Enforces 2GB total size cap to prevent disk bloat
 * - Cross-platform (macOS, Windows, Linux)
 */

import { Logger } from "@services/logging/Logger"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

// Configuration constants
const CLINE_FILE_PREFIX = "cline-"
const MAX_TOTAL_SIZE_BYTES = 2 * 1024 * 1024 * 1024 // 2GB
const MAX_FILE_AGE_MS = 50 * 60 * 60 * 1000 // 50 hours

interface TempFileInfo {
	path: string
	size: number
	mtime: number
}

/**
 * Singleton manager for Cline's temporary files.
 */
class ClineTempManagerImpl {
	private readonly tempDir: string

	constructor() {
		// Uses system temp directly:
		// macOS: /var/folders/xx/.../T/
		// Windows: C:\Users\{user}\AppData\Local\Temp\
		// Linux: /tmp/
		this.tempDir = os.tmpdir()
	}

	/**
	 * Get the temp directory path.
	 */
	getTempDir(): string {
		return this.tempDir
	}

	/**
	 * Create a new temp file path with the given prefix.
	 * Does NOT create the file - just returns the path.
	 *
	 * @param prefix Prefix for the filename (e.g., "large-output", "background")
	 * @returns Full path to the temp file
	 */
	createTempFilePath(prefix: string): string {
		const filename = `${CLINE_FILE_PREFIX}${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.log`
		return path.join(this.tempDir, filename)
	}

	/**
	 * Clean up old Cline temp files based on age and total size constraints.
	 * Called on extension activation.
	 *
	 * Strategy:
	 * 1. Find all files with "cline-" prefix in system temp
	 * 2. Delete all files older than 50 hours
	 * 3. If still over 2GB total, delete oldest files until under limit
	 */
	async cleanup(): Promise<{ deletedCount: number; freedBytes: number }> {
		let deletedCount = 0
		let freedBytes = 0

		try {
			// Get all files in temp directory
			let files: string[]
			try {
				files = await fs.promises.readdir(this.tempDir)
			} catch {
				return { deletedCount: 0, freedBytes: 0 }
			}

			// Filter to only cline- prefixed files
			const clineFiles = files.filter((f) => f.startsWith(CLINE_FILE_PREFIX))

			// Gather info about each file
			const fileInfos: TempFileInfo[] = []
			for (const file of clineFiles) {
				const filePath = path.join(this.tempDir, file)
				try {
					const stats = await fs.promises.stat(filePath)
					if (stats.isFile()) {
						fileInfos.push({
							path: filePath,
							size: stats.size,
							mtime: stats.mtimeMs,
						})
					}
				} catch {}
			}

			const now = Date.now()

			// Phase 1: Delete files older than 50 hours
			for (const fileInfo of fileInfos) {
				const age = now - fileInfo.mtime
				if (age > MAX_FILE_AGE_MS) {
					try {
						await fs.promises.unlink(fileInfo.path)
						deletedCount++
						freedBytes += fileInfo.size
						Logger.info(
							`Cleaned up old temp file: ${path.basename(fileInfo.path)} (age: ${Math.round(age / 3600000)}h)`,
						)
					} catch {
						// File might have been deleted by another process
					}
				}
			}

			// Remove deleted files from the list
			const remainingFiles = fileInfos.filter((f) => {
				const age = now - f.mtime
				return age <= MAX_FILE_AGE_MS
			})

			// Phase 2: Check total size and delete oldest if over limit
			let totalSize = remainingFiles.reduce((sum, f) => sum + f.size, 0)

			if (totalSize > MAX_TOTAL_SIZE_BYTES) {
				// Sort by mtime (oldest first)
				remainingFiles.sort((a, b) => a.mtime - b.mtime)

				for (const fileInfo of remainingFiles) {
					if (totalSize <= MAX_TOTAL_SIZE_BYTES) {
						break
					}

					try {
						await fs.promises.unlink(fileInfo.path)
						totalSize -= fileInfo.size
						deletedCount++
						freedBytes += fileInfo.size
						Logger.info(
							`Cleaned up temp file for space: ${path.basename(fileInfo.path)} (${Math.round(fileInfo.size / 1024)}KB)`,
						)
					} catch {
						// File might have been deleted by another process
					}
				}
			}

			if (deletedCount > 0) {
				Logger.info(`Cline temp cleanup: deleted ${deletedCount} files, freed ${Math.round(freedBytes / 1024 / 1024)}MB`)
			}
		} catch (error) {
			Logger.error("Error during Cline temp cleanup", error)
		}

		return { deletedCount, freedBytes }
	}

	/**
	 * Delete a specific temp file.
	 *
	 * @param filePath Path to the file to delete
	 */
	async deleteFile(filePath: string): Promise<void> {
		try {
			await fs.promises.unlink(filePath)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				Logger.error(`Failed to delete temp file: ${filePath}`, error)
			}
		}
	}
}

// Export singleton instance
export const ClineTempManager = new ClineTempManagerImpl()
