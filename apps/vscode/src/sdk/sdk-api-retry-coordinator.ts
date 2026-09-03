import { Logger } from "@/shared/services/Logger"

export const MAX_RETRY_DELAY_SECONDS = 300

/** First delay of the Fibonacci retry schedule, in seconds (3, 5, 8, 13, 21, …). */
export const FIRST_RETRY_DELAY_SECONDS = 3

export interface RetryAttemptInfo {
	readonly attempt: number
	/** Delay actually scheduled (Fibonacci schedule, or the provider's Retry-After). */
	readonly delaySeconds: number
	readonly error: unknown
}

export interface SdkApiRetryCoordinatorOptions {
	isSessionActive: (sessionId: string) => boolean
	/** Re-drive the failed session; the guard is live across the re-drive's awaits. */
	sendTurn: (sessionId: string, isCancelled: () => boolean) => void
	emitRetryScheduled: (info: RetryAttemptInfo) => void
	onRetryAbandoned?: () => void
	scheduleTimer?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>
	cancelTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

/**
 * Fibonacci retry schedule for an attempt (1-indexed): 3, 5, 8, 13, 21, … capped
 * at `maxSeconds`. Each delay is the sum of the two before it, so early retries
 * land fast while a persistent outage backs off gently and without a retry limit.
 */
export function getFibonacciRetryDelaySeconds(attempt: number, maxSeconds: number = MAX_RETRY_DELAY_SECONDS): number {
	if (!Number.isInteger(attempt) || attempt < 1) {
		return 0
	}
	let prev = FIRST_RETRY_DELAY_SECONDS // attempt 1
	let current = FIRST_RETRY_DELAY_SECONDS + 2 // attempt 2 (5)
	for (let i = 2; i < attempt; i++) {
		const next = prev + current
		prev = current
		current = next
	}
	return Math.min(maxSeconds, attempt === 1 ? prev : current)
}

/**
 * Schedules retries for transiently failed agent turns: unlimited attempts on a
 * deterministic Fibonacci backoff (3, 5, 8, 13, 21, … capped at
 * MAX_RETRY_DELAY_SECONDS), with `Retry-After` honored when sent. Recovery is
 * left to the user (Retry button) only when a failure is not retryable.
 *
 * Cancellation is definitive — a generation counter invalidates scheduled
 * timers and in-flight re-drives alike, even between awaits.
 */
export class SdkApiRetryCoordinator {
	private retryCount = 0
	private generation = 0
	private pendingTimer: ReturnType<typeof setTimeout> | undefined
	private readonly scheduleTimer: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>
	private readonly cancelTimer: (handle: ReturnType<typeof setTimeout>) => void

	constructor(private readonly options: SdkApiRetryCoordinatorOptions) {
		this.scheduleTimer = options.scheduleTimer ?? ((fn, delayMs) => setTimeout(fn, delayMs))
		this.cancelTimer = options.cancelTimer ?? ((handle) => clearTimeout(handle))
	}

	/** How many retries have been scheduled for the current failure streak. */
	get currentRetryCount(): number {
		return this.retryCount
	}

	get hasPendingRetry(): boolean {
		return this.pendingTimer !== undefined
	}

	handleSendError(error: unknown, sessionId: string, retryAfterSeconds?: number): boolean {
		this.clearPending()
		if (!this.options.isSessionActive(sessionId)) {
			return false
		}
		const attempt = ++this.retryCount
		// Retry-After replaces the backoff: the provider explicitly cleared that
		// wait (already clamped by the classifier), so it is used as-is.
		const delaySeconds = retryAfterSeconds ?? getFibonacciRetryDelaySeconds(attempt)
		this.options.emitRetryScheduled({ attempt, delaySeconds, error })

		this.generation += 1
		const scheduledGeneration = this.generation
		// Live for the re-drive's lifetime: a newer schedule, cancel()/reset(), or session loss flips it.
		const isCancelled = () => this.generation !== scheduledGeneration || !this.options.isSessionActive(sessionId)
		this.pendingTimer = this.scheduleTimer(() => {
			this.pendingTimer = undefined
			if (isCancelled()) {
				Logger.log(`[ApiRetry] Abandoning retry #${attempt} for session ${sessionId}: cancelled`)
				this.options.onRetryAbandoned?.()
				return
			}
			Logger.log(`[ApiRetry] Retrying turn #${attempt} for session ${sessionId} after ${delaySeconds}s`)
			this.options.sendTurn(sessionId, isCancelled)
		}, delaySeconds * 1000)
		return true
	}

	/** Clears the retry streak and invalidates scheduled and in-flight retries. */
	reset(): void {
		this.clearPending()
		this.generation += 1
		this.retryCount = 0
	}

	/** Definitively stops scheduled and in-flight retries (e.g. settings changed). */
	cancel(): void {
		this.reset()
	}

	private clearPending(): void {
		if (this.pendingTimer !== undefined) {
			this.cancelTimer(this.pendingTimer)
			this.pendingTimer = undefined
		}
	}
}
