/**
 * Sync module - provides queue-based syncing to S3/R2 storage.
 *
 * This module coordinates the SyncQueue and SyncWorker for robust
 * data synchronization that doesn't block the main extension flow.
 *
 * Uses JSON file storage for:
 * - Data persistence across restarts
 * - No native module dependencies (VS Code compatible)
 * - Atomic file writes for safety
 */
import * as path from "node:path"
import { HostProvider } from "@/hosts/host-provider"
import { blobStorage } from "../../storage/ClineBlobStorage"
import { backfillTasks } from "./backfill"
import { SyncQueue } from "./queue"
import type { SyncWorkerOptions } from "./worker"
import { disposeSyncWorker, initSyncWorker, SyncWorker } from "./worker"

export type { SyncQueueItem, SyncQueueStatus } from "./queue"
// Re-export types and functions
export { SyncQueue } from "./queue"
export type { SyncWorkerEvent, SyncWorkerOptions } from "./worker"
export { disposeSyncWorker, SyncWorker } from "./worker"

let syncQueueInstance: SyncQueue | null = null

/**
 * Get the sync queue file path.
 */
function getSyncQueuePath(): string {
	return path.join(HostProvider.get().globalStorageFsPath, "cache", "sync-queue.json")
}

/**
 * Get the global SyncQueue instance.
 * Returns null if S3 storage is not configured.
 */
function getSyncQueue(): SyncQueue | null {
	if (!blobStorage.isReady()) {
		return null
	}

	if (!syncQueueInstance) {
		syncQueueInstance = SyncQueue.getInstance(getSyncQueuePath())
	}

	return syncQueueInstance
}

/**
 * Initialize the sync system (queue + worker).
 * Should be called during extension activation if S3 storage is configured.
 *
 * @param options Worker configuration options (includes blob store settings)
 * @returns The SyncWorker instance, or null if S3 is not configured
 */
function init(options?: SyncWorkerOptions): SyncWorker | null {
	if (!options?.userDistinctId) {
		return null
	}

	// Initialize blob storage with the provided settings
	blobStorage.init(options)
	if (!blobStorage.isReady()) {
		return null
	}

	const queue = getSyncQueue()
	if (!queue) {
		return null
	}

	const worker = initSyncWorker(queue, options)
	worker.start()

	if (options.backfillEnabled) {
		backfillTasks().catch((err) => console.error("Backfill tasks failed:", err))
	}

	return worker
}

/**
 * Dispose the sync system.
 * Should be called during extension deactivation.
 */
async function dispose(): Promise<void> {
	await disposeSyncWorker()
	if (syncQueueInstance) {
		syncQueueInstance.close()
		syncQueueInstance = null
	}
	SyncQueue.reset()
}

/**
 * Convenience function to enqueue data for sync.
 * This is a fire-and-forget operation - errors are logged but not thrown.
 *
 * @param taskId Task identifier
 * @param key File key (e.g., "api_conversation_history.json")
 * @param data Data to sync
 */
function enqueue(taskId: string, key: string, data: string): void {
	try {
		const queue = getSyncQueue()
		if (!queue || !data || !key) {
			return
		}

		queue.enqueue(taskId, key, data)
	} catch (err) {
		console.error(`Failed to enqueue ${taskId}/${key} for sync:`, err)
	}
}

export function syncWorker() {
	return {
		init,
		dispose,
		getSyncQueue,
		enqueue,
	}
}
