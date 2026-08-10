// Infinite Fibonacci-backoff retry scheduler for failed agent turns.
//
// When a turn's API request fails with a generic send/stream error (NOT an
// auth or balance error — those require user action and are excluded by the
// caller before reaching this coordinator), this reschedules the turn with an
// UNBOUNDED Fibonacci backoff (1s, 1s, 2s, 3s, 5s, 8s, 13s, 21s, … capped at
// MAX_RETRY_DELAY_SECONDS) until the turn succeeds or the user cancels/starts
// something new. Failed requests consume no tokens, so retrying is effectively
// free; the only cost is wall-clock time, which the cap bounds to a 5-minute
// wait per attempt.
//
// Lifecycle (all driven from SdkController):
//   - handleSendError()  → called from onSendError; schedules the next retry
//   - reset()            → called from onSendComplete; a turn succeeded, stop
//   - cancel()           → called from cancelTask/clearTask; stop immediately
//
// The coordinator is a pure scheduler: it owns retry-counting + timing and
// delegates every session mutation (setRunning, fireAndForgetSend, status
// emission) to injected callbacks. That keeps it free of SDK/VS Code
// dependencies and trivially unit-testable with fake timers.

import { Logger } from "@/shared/services/Logger"

/** Maximum seconds to wait between retries (the Fibonacci sequence is capped here). */
export const MAX_RETRY_DELAY_SECONDS = 300

export interface RetryAttemptInfo {
	/** 1-based index of the retry that was just scheduled. */
	readonly attempt: number
	/** Seconds the caller will wait before this retry fires. */
	readonly delaySeconds: number
	/** The error that triggered this retry, for status messaging/telemetry. */
	readonly error: unknown
}

export interface SdkApiRetryCoordinatorOptions {
	/** Returns true when infinite auto-retry is enabled by the user. */
	isAutoRetryEnabled: () => boolean
	/**
	 * Returns true when `sessionId` is still the active session. Re-checked at
	 * schedule time AND inside the timer callback (right before the retry
	 * fires) so a pending retry can never target a replaced/cleared session —
	 * even one that happens to reuse the same sessionId.
	 */
	isSessionActive: (sessionId: string) => boolean
	/** Re-invokes the failed turn through the normal send funnel. */
	sendTurn: (sessionId: string) => void
	/** Emits user-visible status that a retry was scheduled (chat bubble). */
	emitRetryScheduled: (info: RetryAttemptInfo) => void
	/** Injectable timers so the coordinator is deterministic in tests. */
	scheduleTimer?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>
	cancelTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

/**
 * Computes the Fibonacci backoff delay (in seconds) for a 1-based attempt:
 * 1→1, 2→1, 3→2, 4→3, 5→5, 6→8, …, capped at `maxSeconds`.
 */
export function getFibonacciBackoffSeconds(attempt: number, maxSeconds: number = MAX_RETRY_DELAY_SECONDS): number {
	if (!Number.isInteger(attempt) || attempt < 1) {
		return 0
	}
	let prev = 0
	let curr = 1
	for (let i = 2; i <= attempt; i++) {
		const next = prev + curr
		prev = curr
		curr = next
	}
	return Math.min(curr, maxSeconds)
}

export class SdkApiRetryCoordinator {
	private retryCount = 0
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

	/** True when a retry is currently waiting on its backoff timer. */
	get hasPendingRetry(): boolean {
		return this.pendingTimer !== undefined
	}

	/**
	 * Called from onSendError. Returns true if a retry was scheduled (the
	 * caller should keep the turn active and suppress the hard-error UI); false
	 * if no retry will happen (the caller should surface the error as before).
	 */
	handleSendError(error: unknown, sessionId: string): boolean {
		// A fresh failure supersedes any prior pending retry (defensive: in
		// practice onSendError only fires once per failed turn).
		this.clearPending()

		if (!this.options.isAutoRetryEnabled()) {
			return false
		}
		if (!this.options.isSessionActive(sessionId)) {
			return false
		}

		this.retryCount += 1
		const attempt = this.retryCount
		const delaySeconds = getFibonacciBackoffSeconds(attempt)

		this.options.emitRetryScheduled({ attempt, delaySeconds, error })

		this.pendingTimer = this.scheduleTimer(() => {
			this.pendingTimer = undefined
			if (!this.options.isSessionActive(sessionId)) {
				Logger.log(`[ApiRetry] Session ${sessionId} no longer active; aborting retry #${attempt}`)
				return
			}
			Logger.log(`[ApiRetry] Retrying turn #${attempt} for session ${sessionId} after ${delaySeconds}s`)
			this.options.sendTurn(sessionId)
		}, delaySeconds * 1000)

		return true
	}

	/** A turn succeeded — stop retrying and reset the counter. */
	reset(): void {
		if (this.retryCount > 0) {
			Logger.log(`[ApiRetry] Turn succeeded after ${this.retryCount} retr${this.retryCount === 1 ? "y" : "ies"}; resetting`)
		}
		this.clearPending()
		this.retryCount = 0
	}

	/** The task was cancelled/cleared — stop retrying immediately. */
	cancel(): void {
		if (this.pendingTimer) {
			Logger.log(`[ApiRetry] Cancelling pending retry #${this.retryCount}`)
		}
		this.clearPending()
		this.retryCount = 0
	}

	private clearPending(): void {
		if (this.pendingTimer !== undefined) {
			this.cancelTimer(this.pendingTimer)
			this.pendingTimer = undefined
		}
	}
}
