type PresentationPriority = "immediate" | "normal" | "low"

type TaskPresentationSchedulerOptions = {
	flush: () => Promise<void>
	getDelayMs: (priority: PresentationPriority) => number
	setTimeoutFn?: typeof setTimeout
	clearTimeoutFn?: typeof clearTimeout
	onFlushError?: (error: unknown) => void
	getNow?: () => number
	metrics?: {
		onFlushStarted?: (priority: PresentationPriority) => void
		onFlushCompleted?: (durationMs: number, priority: PresentationPriority) => void
	}
}

export class TaskPresentationScheduler {
	private scheduledTimer: ReturnType<typeof setTimeout> | undefined
	private pendingPriority: PresentationPriority | undefined
	private flushInProgress = false
	private disposed = false
	private pendingWhileFlushing = false

	private readonly flush: () => Promise<void>
	private readonly getDelayMs: (priority: PresentationPriority) => number
	private readonly setTimeoutFn: typeof setTimeout
	private readonly clearTimeoutFn: typeof clearTimeout
	private readonly onFlushError?: (error: unknown) => void
	private readonly getNow: () => number
	private readonly metrics?: TaskPresentationSchedulerOptions["metrics"]

	constructor(options: TaskPresentationSchedulerOptions) {
		this.flush = options.flush
		this.getDelayMs = options.getDelayMs
		this.setTimeoutFn = options.setTimeoutFn ?? setTimeout
		this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
		this.onFlushError = options.onFlushError
		this.getNow = options.getNow ?? (() => performance.now())
		this.metrics = options.metrics
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
			}
			void this.runFlushCycle()
			return
		}

		if (this.scheduledTimer) {
			return
		}

		const nextPriority = this.pendingPriority ?? "normal"
		const delayMs = this.getDelayMs(nextPriority)
		this.scheduledTimer = this.setTimeoutFn(() => {
			this.scheduledTimer = undefined
			void this.runFlushCycle()
		}, delayMs)
	}

	async flushNow(): Promise<void> {
		if (this.disposed) {
			return
		}

		this.pendingPriority = this.mergePriority(this.pendingPriority, "immediate")
		if (this.scheduledTimer) {
			this.clearTimeoutFn(this.scheduledTimer)
			this.scheduledTimer = undefined
		}
		await this.runFlushCycle()
	}

	async dispose(): Promise<void> {
		this.disposed = true
		if (this.scheduledTimer) {
			this.clearTimeoutFn(this.scheduledTimer)
			this.scheduledTimer = undefined
		}
		this.pendingPriority = undefined
		this.pendingWhileFlushing = false
	}

	private async runFlushCycle(): Promise<void> {
		if (this.disposed || this.flushInProgress || !this.pendingPriority) {
			return
		}

		this.flushInProgress = true
		const priority = this.pendingPriority
		this.pendingPriority = undefined
		this.pendingWhileFlushing = false
		const startedAt = this.getNow()
		this.metrics?.onFlushStarted?.(priority)

		try {
			await this.flush()
			this.metrics?.onFlushCompleted?.(Math.max(0, this.getNow() - startedAt), priority)
		} catch (error) {
			this.onFlushError?.(error)
		} finally {
			this.flushInProgress = false
		}

		if (this.disposed) {
			return
		}

		if (this.pendingPriority || this.pendingWhileFlushing) {
			const priorityToRun = this.pendingPriority
			if (priorityToRun === "immediate") {
				await this.runFlushCycle()
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
			low: 0,
			normal: 1,
			immediate: 2,
		}

		return rank[next] > rank[current] ? next : current
	}
}

export type { PresentationPriority }
