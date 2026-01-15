import { nanoid } from "nanoid"
import { blobStorage } from "../../storage/ClineBlobStorage"
import { SyncQueue, SyncQueueItem } from "./queue"

/**
 * Configuration options for SyncWorker.
 */
export interface SyncWorkerOptions {
	userDistinctId: string
	/** Interval between sync attempts in milliseconds (default: 30000 = 30s) */
	intervalMs?: number
	/** Maximum number of retries before giving up on an item (default: 5) */
	maxRetries?: number
	/** Batch size - how many items to process per interval (default: 10) */
	batchSize?: number
	/** Whether to run immediately on start (default: true) */
	runImmediately?: boolean
}

enum WorkerEvent {
	WorkerSyncStarted = "sync_started",
	WorkerSyncCompleted = "sync_completed",
	WorkerItemSynced = "item_synced",
	WorkerItemFailed = "item_failed",
	WorkerStarted = "worker_started",
	WorkerStopped = "worker_stopped",
}

/**
 * Event types emitted by SyncWorker.
 */
export type SyncWorkerEvent =
	| { type: WorkerEvent.WorkerSyncStarted; itemCount: number }
	| { type: WorkerEvent.WorkerSyncCompleted; successCount: number; failCount: number }
	| { type: WorkerEvent.WorkerItemSynced; item: SyncQueueItem }
	| { type: WorkerEvent.WorkerItemFailed; item: SyncQueueItem; error: string }
	| { type: WorkerEvent.WorkerStarted }
	| { type: WorkerEvent.WorkerStopped }

export type SyncWorkerEventListener = (event: SyncWorkerEvent) => void

/**
 * Background worker that processes the SyncQueue and uploads data to S3/R2.
 *
 * Features:
 * - Periodic processing of pending items
 * - Configurable retry logic
 * - Event-based notifications for monitoring
 * - Graceful shutdown support
 * - Batch processing to avoid overwhelming the network
 *
 * Usage:
 * ```typescript
 * const queue = SyncQueue.getInstance(dbPath)
 * const worker = new SyncWorker(queue)
 * worker.start()
 *
 * // Later, when shutting down:
 * await worker.stop()
 * ```
 */
export class SyncWorker {
	private interval: ReturnType<typeof setInterval> | null = null
	private isProcessing: boolean = false
	private options: Required<SyncWorkerOptions>
	private listeners: SyncWorkerEventListener[] = []

	constructor(
		private queue: SyncQueue,
		options: SyncWorkerOptions = {
			userDistinctId: nanoid(8),
		},
	) {
		this.options = {
			intervalMs: process?.env?.CLINE_STORAGE_SYNC_INTERVAL_MS
				? parseInt(process.env.CLINE_STORAGE_SYNC_INTERVAL_MS, 10)
				: 30000,
			maxRetries: process?.env?.CLINE_STORAGE_SYNC_MAX_RETRIES
				? parseInt(process.env.CLINE_STORAGE_SYNC_MAX_RETRIES, 10)
				: 5,
			batchSize: process?.env?.CLINE_STORAGE_SYNC_BATCH_SIZE ? parseInt(process.env.CLINE_STORAGE_SYNC_BATCH_SIZE, 10) : 10,
			runImmediately: true,
			...options,
		}
	}

	/**
	 * Subscribe to worker events.
	 * @returns Unsubscribe function
	 */
	onEvent(listener: SyncWorkerEventListener): () => void {
		this.listeners?.push(listener)
		return () => {
			const index = this.listeners.indexOf(listener)
			if (index >= 0) {
				this.listeners.splice(index, 1)
			}
		}
	}

	private emit(event: SyncWorkerEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event)
			} catch (err) {
				console.error("SyncWorker event listener error:", err)
			}
		}
	}

	/**
	 * Start the background worker.
	 */
	start(): void {
		if (this.interval) {
			return // Already running
		}

		this.emit({ type: WorkerEvent.WorkerStarted })
		this.interval = setInterval(() => this.processQueue(), this.options.intervalMs)

		if (this.options.runImmediately) {
			// Run immediately but don't await
			this.processQueue().catch((err) => {
				console.error("SyncWorker initial process error:", err)
			})
		}
	}

	/**
	 * Stop the background worker.
	 * @param waitForCurrent If true, waits for current processing to complete
	 */
	async stop(waitForCurrent: boolean = true): Promise<void> {
		if (this.interval) {
			clearInterval(this.interval)
			this.interval = null
		}

		if (waitForCurrent) {
			// Wait for any in-progress processing to complete
			while (this.isProcessing) {
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
		}

		this.emit({ type: WorkerEvent.WorkerStopped })
	}

	/**
	 * Check if the worker is currently running.
	 */
	isRunning(): boolean {
		return this.interval !== null
	}

	/**
	 * Check if the worker is currently processing items.
	 */
	isCurrentlyProcessing(): boolean {
		return this.isProcessing
	}

	/**
	 * Manually trigger a sync cycle (useful for testing or forced sync).
	 */
	async triggerSync(): Promise<{ successCount: number; failCount: number }> {
		return this.processQueue()
	}

	private async processQueue(): Promise<{ successCount: number; failCount: number }> {
		if (this.isProcessing) {
			return { successCount: 0, failCount: 0 }
		}

		if (!blobStorage.isReady()) {
			// S3/R2 not configured, nothing to do
			return { successCount: 0, failCount: 0 }
		}

		this.isProcessing = true
		let successCount = 0
		let failCount = 0

		try {
			// Get pending items (synchronous with better-sqlite3)
			const batch = this.queue.getPendingBatch(this.options.batchSize)

			if (batch.length === 0) {
				return { successCount: 0, failCount: 0 }
			}

			this.emit({ type: WorkerEvent.WorkerSyncStarted, itemCount: batch.length })

			for (const item of batch) {
				const data = item.data
				// Skip items that have exceeded max retries
				if (!data || item.retryCount >= this.options.maxRetries) {
					continue
				}

				try {
					// Upload to blob store (S3/R2) bucket
					// Example path: <bucketName>/tasks/<userDistinctId>/<taskId>/<key>
					await blobStorage.store(`tasks/${this.options.userDistinctId}/${item.taskId}/${item.key}`, data)

					// Mark as synced and remove from queue (data is in S3 now)
					this.queue.markSynced(item.taskId, item.key, true)
					successCount++
					this.emit({ type: WorkerEvent.WorkerItemSynced, item })
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err)
					this.queue.markFailed(item.taskId, item.key, errorMsg)
					failCount++
					this.emit({ type: WorkerEvent.WorkerItemFailed, item, error: errorMsg })
					console.error(`Failed to sync ${item.taskId}/${item.key}:`, err)
				}
			}

			this.emit({ type: WorkerEvent.WorkerSyncCompleted, successCount, failCount })
		} finally {
			this.isProcessing = false
		}

		return { successCount, failCount }
	}
}

// Singleton instance for the extension
let workerInstance: SyncWorker | null = null

/**
 * Get the global SyncWorker instance.
 * Returns null if not initialized.
 */
export function getSyncWorker(): SyncWorker | null {
	return workerInstance
}

/**
 * Initialize the global SyncWorker instance.
 * Should be called once during extension activation.
 *
 * @param queue The SyncQueue instance
 * @param options Worker configuration options
 */
export function initSyncWorker(queue: SyncQueue, options?: SyncWorkerOptions): SyncWorker {
	if (workerInstance) {
		return workerInstance
	}
	workerInstance = new SyncWorker(queue, options)
	return workerInstance
}

/**
 * Stop and dispose the global SyncWorker instance.
 * Should be called during extension deactivation.
 */
export async function disposeSyncWorker(): Promise<void> {
	await workerInstance?.stop()
	workerInstance = null
}
