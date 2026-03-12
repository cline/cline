type EphemeralMessageFlushSchedulerOptions = {
	flush: () => Promise<void>
	getDelayMs: () => number
	setIntervalFn?: typeof setInterval
	clearIntervalFn?: typeof clearInterval
	onFlushError?: (error: unknown) => void
}

export class EphemeralMessageFlushScheduler {
	private intervalHandle: ReturnType<typeof setInterval> | undefined

	private readonly flush: () => Promise<void>
	private readonly getDelayMs: () => number
	private readonly setIntervalFn: typeof setInterval
	private readonly clearIntervalFn: typeof clearInterval
	private readonly onFlushError?: (error: unknown) => void

	constructor(options: EphemeralMessageFlushSchedulerOptions) {
		this.flush = options.flush
		this.getDelayMs = options.getDelayMs
		this.setIntervalFn = options.setIntervalFn ?? setInterval
		this.clearIntervalFn = options.clearIntervalFn ?? clearInterval
		this.onFlushError = options.onFlushError
	}

	start(): void {
		if (this.intervalHandle) {
			return
		}

		this.intervalHandle = this.setIntervalFn(() => {
			void this.flush().catch((error) => this.onFlushError?.(error))
		}, this.getDelayMs())
	}

	stop(): void {
		if (!this.intervalHandle) {
			return
		}

		this.clearIntervalFn(this.intervalHandle)
		this.intervalHandle = undefined
	}

	dispose(): void {
		this.stop()
	}
}
