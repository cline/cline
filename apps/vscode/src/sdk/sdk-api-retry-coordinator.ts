import { Logger } from "@/shared/services/Logger"

export const MAX_RETRY_DELAY_SECONDS = 300

/** Base delay for the exponential backoff (attempt 1 waits up to 1s). */
export const BASE_RETRY_DELAY_SECONDS = 1

/**
 * Default budget: retries a failure streak may consume before recovery is left
 * to the user (Retry button). Retried requests spend billable tokens even when
 * the response is lost, so the default is bounded; unattended tasks lift the
 * ceiling via the `autoRetryIndefinitely` setting.
 */
export const DEFAULT_MAX_RETRY_ATTEMPTS = 5

export interface RetryAttemptInfo {
	readonly attempt: number
	/** Delay actually scheduled, after jitter and Retry-After. */
	readonly delaySeconds: number
	/** Total retries allowed for this streak; undefined when unlimited. */
	readonly maxAttempts: number | undefined
	readonly error: unknown
}

export interface SdkApiRetryCoordinatorOptions {
	isAutoRetryEnabled: () => boolean
	/** Whether the failure streak has no attempt ceiling (explicit opt-in). */
	isRetryIndefinite: () => boolean
	isSessionActive: (sessionId: string) => boolean
	/** Re-drive the failed session; the guard is live across the re-drive's awaits. */
	sendTurn: (sessionId: string, isCancelled: () => boolean) => void
	emitRetryScheduled: (info: RetryAttemptInfo) => void
	onRetryAbandoned?: () => void
	scheduleTimer?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>
	cancelTimer?: (handle: ReturnType<typeof setTimeout>) => void
	/** Random source for backoff jitter; injectable for tests. */
	random?: () => number
}

/** Exponential backoff schedule for an attempt (1-indexed), capped. */
export function getExponentialBackoffSeconds(attempt: number, maxSeconds: number = MAX_RETRY_DELAY_SECONDS): number {
	if (!Number.isInteger(attempt) || attempt < 1) {
		return 0
	}
	return Math.min(maxSeconds, BASE_RETRY_DELAY_SECONDS * 2 ** (attempt - 1))
}

/**
 * Schedules retries for transiently failed agent turns: bounded attempt budget
 * (DEFAULT_MAX_RETRY_ATTEMPTS, lifted by the `autoRetryIndefinitely` opt-in),
 * exponential backoff with equal jitter, and `Retry-After` honored when sent.
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
	private readonly random: () => number

	constructor(private readonly options: SdkApiRetryCoordinatorOptions) {
		this.scheduleTimer = options.scheduleTimer ?? ((fn, delayMs) => setTimeout(fn, delayMs))
		this.cancelTimer = options.cancelTimer ?? ((handle) => clearTimeout(handle))
		this.random = options.random ?? Math.random
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
		if (!this.options.isAutoRetryEnabled() || !this.options.isSessionActive(sessionId)) {
			return false
		}
		const attempt = ++this.retryCount
		const maxAttempts = this.options.isRetryIndefinite() ? undefined : DEFAULT_MAX_RETRY_ATTEMPTS
		if (attempt > (maxAttempts ?? Infinity)) {
			Logger.log(
				`[ApiRetry] Retry budget exhausted after ${maxAttempts} attempts for session ${sessionId}; leaving recovery to the user`,
			)
			this.retryCount = 0
			return false
		}
		// Retry-After replaces the backoff: the provider explicitly cleared that
		// wait (already clamped by the classifier), so it is used unjittered.
		const delaySeconds = retryAfterSeconds ?? this.jitterDelaySeconds(getExponentialBackoffSeconds(attempt))
		this.options.emitRetryScheduled({ attempt, delaySeconds, maxAttempts, error })

		this.generation += 1
		const scheduledGeneration = this.generation
		// Live for the re-drive's lifetime: a newer schedule, cancel()/reset(), or session loss flips it.
		const isCancelled = () => this.generation !== scheduledGeneration || !this.options.isSessionActive(sessionId)
		this.pendingTimer = this.scheduleTimer(() => {
			this.pendingTimer = undefined
			if (!this.options.isAutoRetryEnabled() || isCancelled()) {
				Logger.log(`[ApiRetry] Abandoning retry #${attempt} for session ${sessionId}: cancelled or disabled`)
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

	/** Equal jitter: half the schedule deterministically, half random. */
	private jitterDelaySeconds(delaySeconds: number): number {
		const half = delaySeconds / 2
		return half + this.random() * half
	}
}
