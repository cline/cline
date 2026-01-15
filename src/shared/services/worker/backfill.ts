/**
 * Backfill utility for syncing existing task data to S3/R2 storage.
 *
 * This module provides functions to backfill historic task data that was
 * created before S3 storage was configured, or to re-sync data after
 * configuration changes.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { GlobalFileNames } from "@/core/storage/disk"
import { HostProvider } from "@/hosts/host-provider"
import { blobStorage, ClineBlobStorage } from "../../storage/ClineBlobStorage"
import { syncWorker } from "./sync"

/**
 * Result of a backfill operation for a single task.
 */
export interface BackfillTaskResult {
	taskId: string
	success: boolean
	filesQueued: string[]
	error?: string
}

/**
 * Result of a full backfill operation.
 */
export interface BackfillResult {
	totalTasks: number
	successCount: number
	failCount: number
	skippedCount: number
	results: BackfillTaskResult[]
}

/**
 * Options for backfill operations.
 */
export interface BackfillOptions {
	/** Only backfill tasks newer than this timestamp */
	sinceTimestamp?: number
	/** Only backfill these specific task IDs */
	taskIds?: string[]
	/** Whether to use queue (true) or direct upload (false). Default: true */
	useQueue?: boolean
	/** Callback for progress updates */
	onProgress?: (current: number, total: number, taskId: string) => void
}

/**
 * Get the tasks directory path.
 */
function getTasksDir(): string {
	return path.join(HostProvider.get().globalStorageFsPath, "tasks")
}

/**
 * List all task IDs in the tasks directory.
 */
async function listTaskIds(): Promise<string[]> {
	const tasksDir = getTasksDir()

	try {
		const entries = await fs.readdir(tasksDir, { withFileTypes: true })
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return []
		}
		throw err
	}
}

/**
 * Get file modification time, or undefined if file doesn't exist.
 */
async function getFileMtime(filePath: string): Promise<number | undefined> {
	try {
		const stat = await fs.stat(filePath)
		return stat.mtimeMs
	} catch {
		return undefined
	}
}

/**
 * Backfill a single task's data to S3/R2.
 *
 * @param taskId Task identifier
 * @param useQueue Whether to use the sync queue (true) or direct upload (false)
 */
export async function backfillTask(taskId: string, useQueue: boolean = true): Promise<BackfillTaskResult> {
	const result: BackfillTaskResult = {
		taskId,
		success: false,
		filesQueued: [],
	}

	const taskDir = path.join(getTasksDir(), taskId)

	try {
		// Check if task directory exists
		try {
			await fs.access(taskDir)
		} catch {
			result.error = "Task directory not found"
			return result
		}

		// Files to sync
		const filesToSync = [
			GlobalFileNames.apiConversationHistory, // api_conversation_history.json
			GlobalFileNames.uiMessages, // ui_messages.json
		]

		if (useQueue) {
			// Queue-based approach (synchronous with better-sqlite3)
			const queue = syncWorker().getSyncQueue()
			if (!queue) {
				result.error = "S3 storage not configured"
				return result
			}

			for (const fileName of filesToSync) {
				const filePath = path.join(taskDir, fileName)
				try {
					const data = await fs.readFile(filePath, "utf-8")
					queue.enqueue(taskId, fileName, data)
					result.filesQueued.push(fileName)
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
						console.error(`Failed to queue ${taskId}/${fileName}:`, err)
					}
					// Skip missing files silently
				}
			}
		} else {
			// Direct upload approach
			if (!blobStorage.isReady()) {
				result.error = "S3 storage not configured"
				return result
			}

			for (const fileName of filesToSync) {
				const filePath = path.join(taskDir, fileName)
				try {
					const data = await fs.readFile(filePath, "utf-8")
					await blobStorage.store(`tasks/${taskId}/${fileName}`, data)
					result.filesQueued.push(fileName)
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
						console.error(`Failed to upload ${taskId}/${fileName}:`, err)
					}
					// Skip missing files silently
				}
			}
		}

		result.success = result.filesQueued.length > 0
	} catch (err) {
		result.error = err instanceof Error ? err.message : String(err)
	}

	return result
}

/**
 * Backfill all existing tasks to S3/R2 storage.
 *
 * @param options Backfill options
 */
export async function backfillAllTasks(options: BackfillOptions = {}): Promise<BackfillResult | undefined> {
	const { sinceTimestamp, taskIds: specificTaskIds, useQueue = true, onProgress } = options

	if (!ClineBlobStorage.isConfigured()) {
		return undefined
	}

	// Get list of tasks to process
	let taskIds: string[]
	if (specificTaskIds && specificTaskIds.length > 0) {
		taskIds = specificTaskIds
	} else {
		taskIds = await listTaskIds()
	}

	const result: BackfillResult = {
		totalTasks: taskIds.length,
		successCount: 0,
		failCount: 0,
		skippedCount: 0,
		results: [],
	}

	for (let i = 0; i < taskIds.length; i++) {
		const taskId = taskIds[i]

		// Check timestamp filter
		if (sinceTimestamp) {
			const taskDir = path.join(getTasksDir(), taskId)
			const apiHistoryPath = path.join(taskDir, GlobalFileNames.apiConversationHistory)
			const mtime = await getFileMtime(apiHistoryPath)

			if (mtime && mtime < sinceTimestamp) {
				result.skippedCount++
				continue
			}
		}

		// Report progress
		if (onProgress) {
			onProgress(i + 1, taskIds.length, taskId)
		}

		// Backfill the task
		const taskResult = await backfillTask(taskId, useQueue)
		result.results.push(taskResult)

		if (taskResult.success) {
			result.successCount++
		} else if (taskResult.error) {
			result.failCount++
		} else {
			result.skippedCount++
		}
	}

	return result
}

/**
 * Get statistics about what would be backfilled without actually doing it.
 */
export async function getBackfillStats(): Promise<{
	totalTasks: number
	tasksWithApiHistory: number
	tasksWithUiMessages: number
	oldestTaskTimestamp?: number
	newestTaskTimestamp?: number
}> {
	const taskIds = await listTaskIds()
	let tasksWithApiHistory = 0
	let tasksWithUiMessages = 0
	let oldestTimestamp: number | undefined
	let newestTimestamp: number | undefined

	for (const taskId of taskIds) {
		const taskDir = path.join(getTasksDir(), taskId)

		const apiHistoryMtime = await getFileMtime(path.join(taskDir, GlobalFileNames.apiConversationHistory))
		const uiMessagesMtime = await getFileMtime(path.join(taskDir, GlobalFileNames.uiMessages))

		if (apiHistoryMtime) {
			tasksWithApiHistory++
			if (!oldestTimestamp || apiHistoryMtime < oldestTimestamp) {
				oldestTimestamp = apiHistoryMtime
			}
			if (!newestTimestamp || apiHistoryMtime > newestTimestamp) {
				newestTimestamp = apiHistoryMtime
			}
		}

		if (uiMessagesMtime) {
			tasksWithUiMessages++
		}
	}

	return {
		totalTasks: taskIds.length,
		tasksWithApiHistory,
		tasksWithUiMessages,
		oldestTaskTimestamp: oldestTimestamp,
		newestTaskTimestamp: newestTimestamp,
	}
}
