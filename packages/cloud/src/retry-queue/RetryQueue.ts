import { EventEmitter } from "events"
import type { ExtensionContext } from "vscode"
import type { QueuedRequest, QueueStats, RetryQueueConfig, RetryQueueEvents } from "./types.js"

type AuthHeaderProvider = () => Record<string, string> | undefined

export class RetryQueue extends EventEmitter<RetryQueueEvents> {
	private queue: Map<string, QueuedRequest> = new Map()
	private context: ExtensionContext
	private config: RetryQueueConfig
	private log: (...args: unknown[]) => void
	private isProcessing = false
	private retryTimer?: NodeJS.Timeout
	private readonly STORAGE_KEY = "roo.retryQueue"
	private authHeaderProvider?: AuthHeaderProvider
	private queuePausedUntil?: number // Timestamp when the queue can resume processing
	private isPaused = false // Manual pause state (e.g., for auth state changes)
	private currentUserId?: string // Track current user ID for conditional clearing
	private hasHadUser = false // Track if we've ever had a user (to distinguish from first login)

	constructor(
		context: ExtensionContext,
		config?: Partial<RetryQueueConfig>,
		log?: (...args: unknown[]) => void,
		authHeaderProvider?: AuthHeaderProvider,
	) {
		super()
		this.context = context
		this.log = log || console.log
		this.authHeaderProvider = authHeaderProvider

		this.config = {
			maxRetries: 0,
			retryDelay: 60000,
			maxQueueSize: 100,
			persistQueue: true,
			networkCheckInterval: 60000,
			requestTimeout: 30000,
			...config,
		}

		this.loadPersistedQueue()
		this.startRetryTimer()
	}

	private loadPersistedQueue(): void {
		if (!this.config.persistQueue) return

		try {
			const stored = this.context.workspaceState.get<QueuedRequest[]>(this.STORAGE_KEY)
			if (stored && Array.isArray(stored)) {
				stored.forEach((request) => {
					this.queue.set(request.id, request)
				})
				this.log(`[RetryQueue] Loaded ${stored.length} persisted requests from workspace storage`)
			}
		} catch (error) {
			this.log("[RetryQueue] Failed to load persisted queue:", error)
		}
	}

	private async persistQueue(): Promise<void> {
		if (!this.config.persistQueue) return

		try {
			const requests = Array.from(this.queue.values())
			await this.context.workspaceState.update(this.STORAGE_KEY, requests)
		} catch (error) {
			this.log("[RetryQueue] Failed to persist queue:", error)
		}
	}

	public async enqueue(
		url: string,
		options: RequestInit,
		type: QueuedRequest["type"] = "other",
		operation?: string,
	): Promise<void> {
		if (this.queue.size >= this.config.maxQueueSize) {
			const oldestId = Array.from(this.queue.keys())[0]
			if (oldestId) {
				this.queue.delete(oldestId)
			}
		}

		const request: QueuedRequest = {
			id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			url,
			options,
			timestamp: Date.now(),
			retryCount: 0,
			type,
			operation,
		}

		this.queue.set(request.id, request)
		await this.persistQueue()

		this.emit("request-queued", request)
		this.log(`[RetryQueue] Queued request: ${url}`)
	}

	public async retryAll(): Promise<void> {
		if (this.isProcessing) {
			this.log("[RetryQueue] Already processing, skipping retry cycle")
			return
		}

		// Check if the queue is manually paused (e.g., due to auth state)
		if (this.isPaused) {
			this.log("[RetryQueue] Queue is manually paused")
			return
		}

		// Check if the entire queue is paused due to rate limiting
		if (this.queuePausedUntil && Date.now() < this.queuePausedUntil) {
			this.log(`[RetryQueue] Queue is paused until ${new Date(this.queuePausedUntil).toISOString()}`)
			return
		}

		const requests = Array.from(this.queue.values())
		if (requests.length === 0) {
			return
		}

		this.isProcessing = true

		try {
			// Sort by timestamp to process in FIFO order (oldest first)
			requests.sort((a, b) => a.timestamp - b.timestamp)

			// Process all requests in FIFO order
			for (const request of requests) {
				try {
					const response = await this.retryRequest(request)

					// Check if we got a 429 rate limiting response
					if (response && response.status === 429) {
						const retryAfter = response.headers.get("Retry-After")
						if (retryAfter) {
							// Parse Retry-After (could be seconds or a date)
							let delayMs: number
							const retryAfterSeconds = parseInt(retryAfter, 10)
							if (!isNaN(retryAfterSeconds)) {
								delayMs = retryAfterSeconds * 1000
							} else {
								// Try parsing as a date
								const retryDate = new Date(retryAfter)
								if (!isNaN(retryDate.getTime())) {
									delayMs = retryDate.getTime() - Date.now()
								} else {
									delayMs = 60000 // Default to 1 minute if we can't parse
								}
							}
							// Pause the entire queue
							this.queuePausedUntil = Date.now() + delayMs
							this.log(`[RetryQueue] Rate limited, pausing entire queue for ${delayMs}ms`)
							// Keep the request in the queue for later retry
							this.queue.set(request.id, request)
							// Stop processing further requests since the queue is paused
							break
						}
					}

					this.queue.delete(request.id)
					this.emit("request-retry-success", request)
				} catch (error) {
					request.retryCount++
					request.lastError = error instanceof Error ? error.message : String(error)

					// Check if we've exceeded max retries
					if (this.config.maxRetries > 0 && request.retryCount >= this.config.maxRetries) {
						this.log(
							`[RetryQueue] Max retries (${this.config.maxRetries}) reached for request: ${request.url}`,
						)
						this.queue.delete(request.id)
						this.emit("request-max-retries-exceeded", request, error as Error)
					} else {
						this.queue.set(request.id, request)
						this.emit("request-retry-failed", request, error as Error)
					}

					// Add a small delay between retry attempts
					await this.delay(100)
				}
			}

			await this.persistQueue()
		} finally {
			// Always reset the processing flag, even if an error occurs
			this.isProcessing = false
		}
	}

	private async retryRequest(request: QueuedRequest): Promise<Response> {
		this.log(`[RetryQueue] Retrying request: ${request.url}`)

		let headers = { ...request.options.headers }
		if (this.authHeaderProvider) {
			const freshAuthHeaders = this.authHeaderProvider()
			if (freshAuthHeaders) {
				headers = {
					...headers,
					...freshAuthHeaders,
				}
			}
		}

		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout)

		try {
			const response = await fetch(request.url, {
				...request.options,
				signal: controller.signal,
				headers: {
					...headers,
					"X-Retry-Queue": "true",
				},
			})

			clearTimeout(timeoutId)

			// Check for error status codes that should trigger retry
			if (!response.ok) {
				// Handle different status codes appropriately
				if (response.status >= 500) {
					// Server errors (5xx) should be retried
					throw new Error(`Server error: ${response.status} ${response.statusText}`)
				} else if (response.status === 429) {
					// Rate limiting - return response to let caller handle Retry-After
					return response
				} else if (response.status >= 400 && response.status < 500) {
					// Client errors (4xx including 401/403) should NOT be retried
					// These errors indicate problems with the request itself that won't be fixed by retrying
					this.log(`[RetryQueue] Non-retryable client error ${response.status}, removing from queue`)
					return response
				}
			}

			return response
		} catch (error) {
			clearTimeout(timeoutId)
			throw error
		}
	}

	private startRetryTimer(): void {
		if (this.retryTimer) {
			clearInterval(this.retryTimer)
		}

		this.retryTimer = setInterval(() => {
			this.retryAll().catch((error) => {
				this.log("[RetryQueue] Error during retry cycle:", error)
			})
		}, this.config.networkCheckInterval)
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	public getStats(): QueueStats {
		const requests = Array.from(this.queue.values())
		const byType: Record<string, number> = {}
		let totalRetries = 0
		let failedRetries = 0

		requests.forEach((request) => {
			byType[request.type] = (byType[request.type] || 0) + 1
			totalRetries += request.retryCount
			if (request.lastError) {
				failedRetries++
			}
		})

		const timestamps = requests.map((r) => r.timestamp)
		const oldestRequest = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : undefined
		const newestRequest = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : undefined

		return {
			totalQueued: requests.length,
			byType,
			oldestRequest,
			newestRequest,
			totalRetries,
			failedRetries,
		}
	}

	public clear(): void {
		this.queue.clear()
		this.persistQueue().catch((error) => {
			this.log("[RetryQueue] Failed to persist after clear:", error)
		})
		this.emit("queue-cleared")
	}

	/**
	 * Pause the retry queue. When paused, no retries will be processed.
	 * This is useful when auth state is not active or during logout.
	 */
	public pause(): void {
		this.isPaused = true
		this.log("[RetryQueue] Queue paused")
	}

	/**
	 * Resume the retry queue. Retries will be processed again on the next interval.
	 */
	public resume(): void {
		this.isPaused = false
		this.log("[RetryQueue] Queue resumed")
	}

	/**
	 * Check if the queue is paused
	 */
	public isPausedState(): boolean {
		return this.isPaused
	}

	/**
	 * Set the current user ID for tracking user changes
	 */
	public setCurrentUserId(userId: string | undefined): void {
		this.currentUserId = userId
	}

	/**
	 * Get the current user ID
	 */
	public getCurrentUserId(): string | undefined {
		return this.currentUserId
	}

	/**
	 * Conditionally clear the queue based on user ID change.
	 * If newUserId is different from currentUserId, clear the queue.
	 * Returns true if queue was cleared, false otherwise.
	 */
	public clearIfUserChanged(newUserId: string | undefined): boolean {
		// First time ever setting a user (initial login)
		if (!this.hasHadUser && newUserId !== undefined) {
			this.currentUserId = newUserId
			this.hasHadUser = true
			return false
		}

		// If user IDs are different (including logout case where newUserId is undefined)
		if (this.currentUserId !== newUserId) {
			this.log(`[RetryQueue] User changed from ${this.currentUserId} to ${newUserId}, clearing queue`)
			this.clear()
			this.currentUserId = newUserId
			if (newUserId !== undefined) {
				this.hasHadUser = true
			}
			return true
		}

		return false
	}

	public dispose(): void {
		if (this.retryTimer) {
			clearInterval(this.retryTimer)
		}
		this.removeAllListeners()
	}
}
