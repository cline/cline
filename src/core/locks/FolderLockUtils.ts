import type { SqliteLockManager } from "./SqliteLockManager"
import type { FolderLockOptions, FolderLockResult, FolderLockWithRetryResult } from "./types"

/**
 * Retry configuration for folder lock acquisition
 */
export interface FolderLockRetryConfig {
	initialDelayMs: number
	incrementPerAttemptMs: number
	maxTotalTimeoutMs: number
}

/**
 * Default retry configuration for folder locks:
 * - 500ms initial wait - this is typically enough for most cases
 * - +1s backoff per attempt
 * - 30s max total timeout
 */
export const DEFAULT_RETRY_CONFIG: FolderLockRetryConfig = {
	initialDelayMs: 500,
	incrementPerAttemptMs: 1000,
	maxTotalTimeoutMs: 30000,
}

/**
 * Get the lock manager instance for standalone mode.
 */
export async function getStandaloneLockManager(): Promise<SqliteLockManager | undefined> {
	try {
		const { getLockManager } = await import("../../standalone/lock-manager")
		return getLockManager()
	} catch (_importError) {
		console.debug("Lock manager not available")
		return undefined
	}
}

/**
 * Attempt to acquire a folder lock with retry logic.
 * This is a generic utility that works with any folder path.
 *
 * @param lockTarget - The folder path to lock
 * @param config - Optional retry configuration if defaults are not suitable
 * @returns Promise<boolean> true if lock acquired, false if timeout
 */
export async function tryAcquireFolderLockWithRetry(
	options: FolderLockOptions,
	config?: FolderLockRetryConfig,
): Promise<FolderLockWithRetryResult> {
	return await retryFolderLockAcquisition(async () => {
		try {
			const lockManager = await getStandaloneLockManager()

			if (!lockManager) {
				console.debug("Lock manager not available - skipping lock acquisition")
				return { acquired: false, skipped: true }
			}

			console.log(`Attempting to acquire folder lock for: ${options.lockTarget}`)

			const result = await acquireFolderLock(options)

			return { acquired: result.acquired, conflictingLock: result.conflictingLock, skipped: false }
		} catch (error) {
			console.error("Error in folder lock acquisition attempt:", error)
			return { acquired: false }
		}
	}, config)
}

/**
 * Release a folder lock safely with error handling.
 * This is a generic utility that works with any folder path.
 *
 * @param lockTarget - The folder path to release
 */
export async function releaseFolderLock(taskId: string, lockTarget: string): Promise<void> {
	try {
		const lockManager = await getStandaloneLockManager()

		if (!lockManager) {
			console.debug("Lock manager not available - skipping lock release")
			return
		}

		await lockManager.releaseFolderLockByTarget(taskId, lockTarget)
		console.log(`Released folder lock for: ${lockTarget}`)
	} catch (error) {
		console.error("Error releasing folder lock:", error)
	}
}

/**
 * Acquire a folder lock with no retry
 * @param options - Folder lock options including heldBy
 * @returns Result indicating if lock was acquired and any conflicting lock
 */
export async function acquireFolderLock(options: FolderLockOptions): Promise<FolderLockResult> {
	const lockManager = await getStandaloneLockManager()

	if (!lockManager) {
		console.debug("Lock manager not available - cannot acquire folder lock")
		return { acquired: false }
	}

	try {
		const conflictingLock = await lockManager.registerFolderLock(options.heldBy, options.lockTarget)

		if (conflictingLock === null) {
			// Lock was successfully acquired
			return { acquired: true }
		} else {
			// Lock already exists, return the conflicting lock
			return {
				acquired: false,
				conflictingLock,
			}
		}
	} catch (error) {
		console.error("Failed to acquire folder lock:", error)
		return { acquired: false }
	}
}

/**
 * Retry a folder lock acquisition with exponential backoff.
 * @param operation - Function that attempts to acquire the lock
 * @param config - Optional retry configuration, uses defaults if not provided
 * @returns Promise that resolves with acquisition status and details
 */
export async function retryFolderLockAcquisition(
	operation: () => Promise<FolderLockWithRetryResult>,
	config: FolderLockRetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<FolderLockWithRetryResult> {
	const startTime = Date.now()
	let attemptCount = 0
	let lastResult: FolderLockWithRetryResult | undefined

	while (true) {
		const elapsedTime = Date.now() - startTime

		// Retries = check timeout before starting next attempt
		if (elapsedTime >= config.maxTotalTimeoutMs) {
			console.warn(`Folder lock acquisition timed out after ${config.maxTotalTimeoutMs}ms`)
			return lastResult || { acquired: false }
		}

		// Attempt lock acquisition
		try {
			const result = await operation()
			lastResult = result

			// Return immediately if skipped or acquired
			if (result.skipped || result.acquired) {
				if (result.acquired && attemptCount > 0) {
					console.debug(`Folder lock acquired after ${attemptCount + 1} attempts (${elapsedTime}ms)`)
				}
				return result
			}
		} catch (error) {
			console.error(`Error during folder lock acquisition attempt ${attemptCount + 1}:`, error)
		}

		// Prep for next attempt
		attemptCount++
		const baseDelay = config.initialDelayMs + attemptCount * config.incrementPerAttemptMs
		const remainingTime = config.maxTotalTimeoutMs - (Date.now() - startTime)
		const delay = Math.min(baseDelay, Math.max(0, remainingTime))

		if (delay <= 0) {
			console.warn(`Folder lock acquisition timed out after ${config.maxTotalTimeoutMs}ms`)
			return lastResult || { acquired: false }
		}

		console.log(`Folder lock held by another instance, retrying in ${delay}ms (attempt ${attemptCount})`)
		await new Promise((resolve) => setTimeout(resolve, delay))
	}
}
