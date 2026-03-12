type TaskUsageUpdateSchedulerOptions = {
	getDelayMs: () => number
	setTimeoutFn?: typeof setTimeout
	clearTimeoutFn?: typeof clearTimeout
	onSideEffectError?: (error: unknown) => void
	onUiFlushError?: (error: unknown) => void
}

type UsageUpdateWork = {
	sideEffect?: () => Promise<void>
	flushUi?: () => Promise<void>
}

export class TaskUsageUpdateScheduler {
	private sideEffectsQueue = Promise.resolve()
	private flushScheduled = false
	private timer: ReturnType<typeof setTimeout> | undefined
	private finalized = false

	private readonly getDelayMs: () => number
	private readonly setTimeoutFn: typeof setTimeout
	private readonly clearTimeoutFn: typeof clearTimeout
	private readonly onSideEffectError?: (error: unknown) => void
	private readonly onUiFlushError?: (error: unknown) => void

	constructor(options: TaskUsageUpdateSchedulerOptions) {
		this.getDelayMs = options.getDelayMs
		this.setTimeoutFn = options.setTimeoutFn ?? setTimeout
		this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
		this.onSideEffectError = options.onSideEffectError
		this.onUiFlushError = options.onUiFlushError
	}

	enqueue(work: UsageUpdateWork): void {
		if (this.finalized) {
			return
		}

		if (work.sideEffect) {
			this.sideEffectsQueue = this.sideEffectsQueue.then(work.sideEffect).catch((error) => this.onSideEffectError?.(error))
		}

		if (!work.flushUi || this.flushScheduled || this.finalized) {
			return
		}

		this.flushScheduled = true
		this.clearTimer()
		this.timer = this.setTimeoutFn(() => {
			this.timer = undefined
			this.sideEffectsQueue = this.sideEffectsQueue
				.then(async () => {
					if (this.finalized) {
						return
					}
					this.flushScheduled = false
					await work.flushUi?.()
				})
				.catch((error) => {
					this.flushScheduled = false
					this.onUiFlushError?.(error)
				})
		}, this.getDelayMs())
	}

	async flushFinal(flushUi?: () => Promise<void>): Promise<void> {
		this.finalized = true
		this.flushScheduled = false
		this.clearTimer()
		await this.sideEffectsQueue
		await flushUi?.()
	}

	dispose(): void {
		this.finalized = true
		this.flushScheduled = false
		this.clearTimer()
	}

	private clearTimer(): void {
		if (this.timer) {
			this.clearTimeoutFn(this.timer)
			this.timer = undefined
		}
	}
}
