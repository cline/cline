import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import * as lockfile from "proper-lockfile"
import Disassembler from "stream-json/Disassembler"
import Stringer from "stream-json/Stringer"

/**
 * Safely writes JSON data to a file.
 * - Creates parent directories if they don't exist
 * - Uses 'proper-lockfile' for inter-process advisory locking to prevent concurrent writes to the same path.
 * - Writes to a temporary file first.
 * - If the target file exists, it's backed up before being replaced.
 * - Attempts to roll back and clean up in case of errors.
 *
 * @param {string} filePath - The absolute path to the target file.
 * @param {any} data - The data to serialize to JSON and write.
 * @returns {Promise<void>}
 */

async function safeWriteJson(filePath: string, data: any): Promise<void> {
	const absoluteFilePath = path.resolve(filePath)
	let releaseLock = async () => {} // Initialized to a no-op

	// For directory creation
	const dirPath = path.dirname(absoluteFilePath)

	// Ensure directory structure exists with improved reliability
	try {
		// Create directory with recursive option
		await fs.mkdir(dirPath, { recursive: true })

		// Verify directory exists after creation attempt
		await fs.access(dirPath)
	} catch (dirError: any) {
		console.error(`Failed to create or access directory for ${absoluteFilePath}:`, dirError)
		throw dirError
	}

	// Acquire the lock before any file operations
	try {
		releaseLock = await lockfile.lock(absoluteFilePath, {
			stale: 31000, // Stale after 31 seconds
			update: 10000, // Update mtime every 10 seconds to prevent staleness if operation is long
			realpath: false, // the file may not exist yet, which is acceptable
			retries: {
				// Configuration for retrying lock acquisition
				retries: 5, // Number of retries after the initial attempt
				factor: 2, // Exponential backoff factor (e.g., 100ms, 200ms, 400ms, ...)
				minTimeout: 100, // Minimum time to wait before the first retry (in ms)
				maxTimeout: 1000, // Maximum time to wait for any single retry (in ms)
			},
			onCompromised: (err) => {
				console.error(`Lock at ${absoluteFilePath} was compromised:`, err)
				throw err
			},
		})
	} catch (lockError) {
		// If lock acquisition fails, we throw immediately.
		// The releaseLock remains a no-op, so the finally block in the main file operations
		// try-catch-finally won't try to release an unacquired lock if this path is taken.
		console.error(`Failed to acquire lock for ${absoluteFilePath}:`, lockError)
		// Propagate the lock acquisition error
		throw lockError
	}

	// Variables to hold the actual paths of temp files if they are created.
	let actualTempNewFilePath: string | null = null
	let actualTempBackupFilePath: string | null = null

	try {
		// Step 1: Write data to a new temporary file.
		actualTempNewFilePath = path.join(
			path.dirname(absoluteFilePath),
			`.${path.basename(absoluteFilePath)}.new_${Date.now()}_${Math.random().toString(36).substring(2)}.tmp`,
		)

		await _streamDataToFile(actualTempNewFilePath, data)

		// Step 2: Check if the target file exists. If so, rename it to a backup path.
		try {
			// Check for target file existence
			await fs.access(absoluteFilePath)
			// Target exists, create a backup path and rename.
			actualTempBackupFilePath = path.join(
				path.dirname(absoluteFilePath),
				`.${path.basename(absoluteFilePath)}.bak_${Date.now()}_${Math.random().toString(36).substring(2)}.tmp`,
			)
			await fs.rename(absoluteFilePath, actualTempBackupFilePath)
		} catch (accessError: any) {
			// Explicitly type accessError
			if (accessError.code !== "ENOENT") {
				// An error other than "file not found" occurred during access check.
				throw accessError
			}
			// Target file does not exist, so no backup is made. actualTempBackupFilePath remains null.
		}

		// Step 3: Rename the new temporary file to the target file path.
		// This is the main "commit" step.
		await fs.rename(actualTempNewFilePath, absoluteFilePath)

		// If we reach here, the new file is successfully in place.
		// The original actualTempNewFilePath is now the main file, so we shouldn't try to clean it up as "temp".
		// Mark as "used" or "committed"
		actualTempNewFilePath = null

		// Step 4: If a backup was created, attempt to delete it.
		if (actualTempBackupFilePath) {
			try {
				await fs.unlink(actualTempBackupFilePath)
				// Mark backup as handled
				actualTempBackupFilePath = null
			} catch (unlinkBackupError) {
				// Log this error, but do not re-throw. The main operation was successful.
				// actualTempBackupFilePath remains set, indicating an orphaned backup.
				console.error(
					`Successfully wrote ${absoluteFilePath}, but failed to clean up backup ${actualTempBackupFilePath}:`,
					unlinkBackupError,
				)
			}
		}
	} catch (originalError) {
		console.error(`Operation failed for ${absoluteFilePath}: [Original Error Caught]`, originalError)

		const newFileToCleanupWithinCatch = actualTempNewFilePath
		const backupFileToRollbackOrCleanupWithinCatch = actualTempBackupFilePath

		// Attempt rollback if a backup was made
		if (backupFileToRollbackOrCleanupWithinCatch) {
			try {
				await fs.rename(backupFileToRollbackOrCleanupWithinCatch, absoluteFilePath)
				// Mark as handled, prevent later unlink of this path
				actualTempBackupFilePath = null
			} catch (rollbackError) {
				// actualTempBackupFilePath (outer scope) remains pointing to backupFileToRollbackOrCleanupWithinCatch
				console.error(
					`[Catch] Failed to restore backup ${backupFileToRollbackOrCleanupWithinCatch} to ${absoluteFilePath}:`,
					rollbackError,
				)
			}
		}

		// Cleanup the .new file if it exists
		if (newFileToCleanupWithinCatch) {
			try {
				await fs.unlink(newFileToCleanupWithinCatch)
			} catch (cleanupError) {
				console.error(
					`[Catch] Failed to clean up temporary new file ${newFileToCleanupWithinCatch}:`,
					cleanupError,
				)
			}
		}

		// Cleanup the .bak file if it still needs to be (i.e., wasn't successfully restored)
		if (actualTempBackupFilePath) {
			try {
				await fs.unlink(actualTempBackupFilePath)
			} catch (cleanupError) {
				console.error(
					`[Catch] Failed to clean up temporary backup file ${actualTempBackupFilePath}:`,
					cleanupError,
				)
			}
		}
		throw originalError // This MUST be the error that rejects the promise.
	} finally {
		// Release the lock in the main finally block.
		try {
			// releaseLock will be the actual unlock function if lock was acquired,
			// or the initial no-op if acquisition failed.
			await releaseLock()
		} catch (unlockError) {
			// Do not re-throw here, as the originalError from the try/catch (if any) is more important.
			console.error(`Failed to release lock for ${absoluteFilePath}:`, unlockError)
		}
	}
}

/**
 * Helper function to stream JSON data to a file.
 * @param targetPath The path to write the stream to.
 * @param data The data to stream.
 * @returns Promise<void>
 */
async function _streamDataToFile(targetPath: string, data: any): Promise<void> {
	// Stream data to avoid high memory usage for large JSON objects.
	const fileWriteStream = fsSync.createWriteStream(targetPath, { encoding: "utf8" })
	const disassembler = Disassembler.disassembler()
	// Output will be compact JSON as standard Stringer is used.
	const stringer = Stringer.stringer()

	return new Promise<void>((resolve, reject) => {
		let errorOccurred = false
		const handleError = (_streamName: string) => (err: Error) => {
			if (!errorOccurred) {
				errorOccurred = true
				if (!fileWriteStream.destroyed) {
					fileWriteStream.destroy(err)
				}
				reject(err)
			}
		}

		disassembler.on("error", handleError("Disassembler"))
		stringer.on("error", handleError("Stringer"))
		fileWriteStream.on("error", (err: Error) => {
			if (!errorOccurred) {
				errorOccurred = true
				reject(err)
			}
		})

		fileWriteStream.on("finish", () => {
			if (!errorOccurred) {
				resolve()
			}
		})

		disassembler.pipe(stringer).pipe(fileWriteStream)

		// stream-json's Disassembler might error if `data` is undefined.
		// JSON.stringify(undefined) would produce the string "undefined" if it's the root value.
		// Writing 'null' is a safer JSON representation for a root undefined value.
		if (data === undefined) {
			disassembler.write(null)
		} else {
			disassembler.write(data)
		}
		disassembler.end()
	})
}

export { safeWriteJson }
