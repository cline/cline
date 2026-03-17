type PresentationPriority = "immediate" | "normal"

type TaskPresentationSchedulerOptions = {
	flush: () => Promise<void>
	getDelayMs: (priority: PresentationPriority) => number
	setTimeoutFn?: typeof setTimeout
	clearTimeoutFn?: typeof clearTimeout
	onFlushError?: (error: unknown) => void
}

export class TaskPresentationScheduler {
	private scheduledTimer: ReturnType<typeof setTimeout> | undefined
	private scheduledPriority: PresentationPriority | undefined
	private pendingPriority: PresentationPriority | undefined
	private flushInProgress = false
	private currentFlushCompletion: Promise<{ error?: unknown }> | undefined
	private disposed = false
	private pendingWhileFlushing = false

	private readonly flush: () => Promise<void>
	private readonly getDelayMs: (priority: PresentationPriority) => number
	private readonly setTimeoutFn: typeof setTimeout
	private readonly clearTimeoutFn: typeof clearTimeout
	private readonly onFlushError?: (error: unknown) => void

	constructor(options: TaskPresentationSchedulerOptions) {
		this.flush = options.flush
		this.getDelayMs = options.getDelayMs
		this.setTimeoutFn = options.setTimeoutFn ?? setTimeout
		this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
		this.onFlushError = options.onFlushError
	}

	requestFlush(priority: PresentationPriority = "normal"): void {
		if (this.disposed) {
			return
		}

		this.pendingPriority = this.mergePriority(this.pendingPriority, priority)

		if (this.flushInProgress) {
			this.pendingWhileFlushing = true
			return
		}

		if (this.pendingPriority === "immediate") {
			if (this.scheduledTimer) {
				this.clearTimeoutFn(this.scheduledTimer)
				this.scheduledTimer = undefined
				this.scheduledPriority = undefined
			}
			void this.runFlushCycle({ rethrowErrors: false })
			return
		}

		const nextPriority = this.pendingPriority ?? "normal"

		if (this.scheduledTimer) {
			if (this.scheduledPriority === nextPriority) {
				return
			}

			this.clearTimeoutFn(this.scheduledTimer)
			this.scheduledTimer = undefined
			this.scheduledPriority = undefined
		}

		if (!this.pendingPriority) {
			return
		}

		const delayMs = this.getDelayMs(nextPriority)
		this.scheduledPriority = nextPriority
		this.scheduledTimer = this.setTimeoutFn(() => {
			this.scheduledTimer = undefined
			this.scheduledPriority = undefined
			void this.runFlushCycle({ rethrowErrors: false })
		}, delayMs)
	}

	/**
	 * Flush immediately and await completion.
	 *
	 * If the scheduler has already been disposed this is a no-op and resolves
	 * without error. Callers that need a guarantee that the final presentation
	 * was delivered should ensure `dispose()` has not been called before
	 * invoking `flushNow()` (the task streaming finalization path does this
	 * correctly because `dispose()` is only called during `abortTask()`).
	 */
	async flushNow(): Promise<void> {
		if (this.disposed) {
			return
		}

		this.pendingPriority = this.mergePriority(this.pendingPriority, "immediate")
		if (this.scheduledTimer) {
			this.clearTimeoutFn(this.scheduledTimer)
			this.scheduledTimer = undefined
			this.scheduledPriority = undefined
		}

		await this.runFlushCycle({ rethrowErrors: true })
	}

	/**
	 * Cancel any pending timers and clear queued state without marking the scheduler
	 * as disposed. Use this between API request retries within the same task to prevent
	 * stale timers from firing against reset streaming state.
	 */
	reset(): void {
		if (this.disposed) {
			return
		}
		if (this.scheduledTimer) {
			this.clearTimeoutFn(this.scheduledTimer)
			this.scheduledTimer = undefined
		}
		this.scheduledPriority = undefined
		this.pendingPriority = undefined
		this.pendingWhileFlushing = false
		// Note: we intentionally do NOT clear flushInProgress or currentFlushCompletion
		// here. If a flush is in-flight it will complete naturally. The reset only
		// prevents *new* timer-driven flushes from firing on stale state.
	}

	async dispose(): Promise<void> {
		this.disposed = true
		if (this.scheduledTimer) {
			this.clearTimeoutFn(this.scheduledTimer)
			this.scheduledTimer = undefined
		}
		this.scheduledPriority = undefined
		this.pendingPriority = undefined
		this.pendingWhileFlushing = false

		const inFlightFlush = this.currentFlushCompletion
		if (inFlightFlush) {
			await inFlightFlush
		}
	}

	private async runFlushCycle(options: { rethrowErrors: boolean }): Promise<void> {
		if (this.disposed) {
			return
		}

		if (this.flushInProgress) {
			const inFlightResult = await this.currentFlushCompletion
			if (options.rethrowErrors && inFlightResult?.error) {
				throw inFlightResult.error
			}
			// Re-check flushInProgress: another concurrent caller may have already
			// started a new flush cycle after the same in-flight flush resolved.
			// Without this guard both callers would proceed past the pendingPriority
			// check and start concurrent flushes against the same presentation state.
			if (this.flushInProgress || this.disposed || !this.pendingPriority) {
				return
			}
		}

		if (!this.pendingPriority) {
			return
		}

		this.flushInProgress = true
		this.pendingPriority = undefined
		this.pendingWhileFlushing = false

		this.currentFlushCompletion = (async () => {
			try {
				await this.flush()
				return {}
			} catch (error) {
				this.onFlushError?.(error)
				return { error }
			} finally {
				this.flushInProgress = false
			}
		})()

		const result = await this.currentFlushCompletion
		this.currentFlushCompletion = undefined
		if (result.error && options.rethrowErrors) {
			throw result.error
		}

		if (this.disposed) {
			return
		}

		if (this.pendingPriority || this.pendingWhileFlushing) {
			const priorityToRun = this.pendingPriority
			if (priorityToRun === "immediate") {
				await this.runFlushCycle(options)
			} else {
				this.requestFlush(priorityToRun ?? "normal")
			}
		}
	}

	private mergePriority(current: PresentationPriority | undefined, next: PresentationPriority): PresentationPriority {
		if (!current) {
			return next
		}

		const rank: Record<PresentationPriority, number> = {
			normal: 0,
			immediate: 1,
		}

		return rank[next] > rank[current] ? next : current
	}
}

export type { PresentationPriority }
