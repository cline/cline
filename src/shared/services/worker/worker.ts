import { BlobStoreSettings, blobStorage } from "../../storage/ClineBlobStorage"
import { SyncQueue, SyncQueueItem } from "./queue"

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Configuration options for SyncWorker.
 */
export interface SyncWorkerOptions extends BlobStoreSettings {
	userDistinctId: string
}

/**
 * Safely parse an environment variable as an integer with a fallback default.
 * Returns the fallback if the value is undefined, empty, or results in NaN.
 */
function parseIntEnv(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback
	}
	const parsed = parseInt(value, 10)
	return Number.isNaN(parsed) ? fallback : parsed
}

/**
 * Get blob store settings from environment variables.
 * Used as a fallback when remote config is not available.
 */
export function getBlobStoreSettingsFromEnv(): BlobStoreSettings {
	return {
		adapterType: process?.env?.CLINE_STORAGE_ADAPTER || "unknown",
		bucket: process?.env?.CLINE_STORAGE_BUCKET || "cline",
		accessKeyId: process?.env?.CLINE_STORAGE_ACCESS_KEY_ID || "",
		secretAccessKey: process?.env?.CLINE_STORAGE_SECRET_ACCESS_KEY || "",
		region: process?.env?.CLINE_STORAGE_REGION,
		endpoint: process?.env?.CLINE_STORAGE_ENDPOINT,
		accountId: process?.env?.CLINE_STORAGE_ACCOUNT_ID,

		intervalMs: parseIntEnv(process.env.CLINE_STORAGE_SYNC_INTERVAL_MS, 30000),
		maxRetries: parseIntEnv(process.env.CLINE_STORAGE_SYNC_MAX_RETRIES, 5),
		batchSize: parseIntEnv(process.env.CLINE_STORAGE_SYNC_BATCH_SIZE, 10),
		maxQueueSize: parseIntEnv(process.env.CLINE_STORAGE_SYNC_MAX_QUEUE_SIZE, 1000),
		maxFailedAgeMs: parseIntEnv(process.env.CLINE_STORAGE_SYNC_MAX_FAILED_AGE_MS, SEVEN_DAYS_MS),
		backfillEnabled: process.env.CLINE_STORAGE_SYNC_BACKFILL_ENABLED === "true",
	}
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
/** Internal type with all optional worker fields required */
type ResolvedSyncWorkerOptions = SyncWorkerOptions &
	Required<
		Pick<BlobStoreSettings, "intervalMs" | "maxRetries" | "batchSize" | "maxQueueSize" | "maxFailedAgeMs" | "backfillEnabled">
	>

export class SyncWorker {
	private interval: ReturnType<typeof setInterval> | null = null
	private isProcessing: boolean = false
	private options: ResolvedSyncWorkerOptions
	private listeners: SyncWorkerEventListener[] = []

	constructor(
		private queue: SyncQueue,
		options: SyncWorkerOptions,
	) {
		this.options = {
			// Apply defaults for optional fields
			intervalMs: options.intervalMs ?? 30000,
			maxRetries: options.maxRetries ?? 5,
			batchSize: options.batchSize ?? 10,
			maxQueueSize: options.maxQueueSize ?? 1000,
			maxFailedAgeMs: options.maxFailedAgeMs ?? SEVEN_DAYS_MS,
			backfillEnabled: options.backfillEnabled ?? false,
			// Spread provided options (required fields come from here)
			...options,
		}
	}

	/**
	 * Subscribe to worker events.
	 * @returns Unsubscribe function
	 */
	public onEvent(listener: SyncWorkerEventListener): () => void {
		this.listeners.push(listener)
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
	public start(): void {
		if (this.interval) {
			return // Already running
		}

		this.emit({ type: WorkerEvent.WorkerStarted })
		this.interval = setInterval(() => this.processQueue(), this.options.intervalMs)

		// Run immediately but don't await
		this.processQueue().catch((err) => {
			console.error("SyncWorker initial process error:", err)
		})
	}

	/**
	 * Stop the background worker.
	 * @param waitForCurrent If true, waits for current processing to complete
	 */
	public async stop(waitForCurrent: boolean = true): Promise<void> {
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
	 * Check if the worker is:
	 * - currently running
	 * - currently processing items
	 */
	public getStatus() {
		return { isRunning: this.interval !== null, isProcessing: this.isProcessing }
	}

	private async processQueue(): Promise<{ successCount: number; failCount: number }> {
		if (this.isProcessing) {
			return { successCount: 0, failCount: 0 }
		}

		this.isProcessing = true
		let successCount = 0
		let failCount = 0

		try {
			// Run cleanup to prevent unbounded queue growth
			// This runs even if blob storage isn't ready, which is the main protection
			// against misconfigured storage causing the queue to grow forever
			this.queue.cleanupFailedItems(this.options.maxRetries, this.options.maxFailedAgeMs)
			this.queue.enforceMaxSize(this.options.maxQueueSize)

			if (!blobStorage.isReady()) {
				// S3/R2 not configured, nothing more to do
				return { successCount: 0, failCount: 0 }
			}

			// Get pending items
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
 * Initialize the global SyncWorker instance.
 * Should be called once during extension activation.
 *
 * @param queue The SyncQueue instance
 * @param options Worker configuration options (required, includes blob store settings)
 */
export function initSyncWorker(queue: SyncQueue, options: SyncWorkerOptions): SyncWorker {
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
