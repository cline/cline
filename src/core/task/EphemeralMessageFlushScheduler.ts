type EphemeralMessageFlushSchedulerOptions = {
	flush: () => Promise<void>
	getDelayMs: () => number
	setIntervalFn?: typeof setInterval
	clearIntervalFn?: typeof clearInterval
	onFlushError?: (error: unknown) => void
}

export class EphemeralMessageFlushScheduler {
	private intervalHandle: ReturnType<typeof setInterval> | undefined
	private flushInFlight = false

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
			if (this.flushInFlight) {
				return
			}

			this.flushInFlight = true
			void this.flush()
				.catch((error) => this.onFlushError?.(error))
				.finally(() => {
					this.flushInFlight = false
				})
		}, this.getDelayMs())
	}

	stop(): void {
		if (!this.intervalHandle) {
			return
		}

		this.clearIntervalFn(this.intervalHandle)
		this.intervalHandle = undefined
		this.flushInFlight = false
	}

	dispose(): void {
		this.stop()
	}
}
