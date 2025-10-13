export interface SlidingWindowLimits {
	rpmLimit?: number | null
	tpmLimit?: number | null
	windowMs?: number
	nearThreshold?: number // 0-1 (fraction of limit at which we start dwelling)
}

type TokenEvent = { ts: number; delta: number }

/**
 * SlidingWindowLimiter tracks Requests Per Minute (RPM) and Tokens Per Minute (TPM)
 * within a sliding time window. It provides:
 * - waitIfNeeded(estimatedTokens): preflight dwell before a request if near/exceeding limits
 * - onRequestStart(): records a request hit
 * - onUsage(deltaTokens): records token usage as it streams
 * - getStats(): returns current window usage vs limits
 *
 * Implementation details:
 * - Maintains two ordered queues: request timestamps and token events (ts, delta)
 * - All state-mutating operations are serialized via a simple internal queue to avoid races
 * - Preflight dwell computes the minimal time until usage decays below nearThreshold * limits
 *   (and has capacity for the estimated tokens) and awaits that duration.
 */
export class SlidingWindowLimiter {
	private rpmLimit?: number
	private tpmLimit?: number
	private windowMs: number
	private nearThreshold: number

	private requestTimes: number[] = []
	private tokenEvents: TokenEvent[] = []

	// Simple promise queue to serialize state operations
	private queue: Promise<void> = Promise.resolve()

	constructor(limits: SlidingWindowLimits) {
		this.windowMs = limits.windowMs ?? 60_000
		this.rpmLimit = toPositiveNumberOrUndefined(limits.rpmLimit)
		this.tpmLimit = toPositiveNumberOrUndefined(limits.tpmLimit)
		this.nearThreshold = clampNearThreshold(limits.nearThreshold)
	}

	setLimits(limits: Partial<SlidingWindowLimits>) {
		if (limits.windowMs !== undefined) this.windowMs = limits.windowMs
		if (limits.rpmLimit !== undefined) this.rpmLimit = toPositiveNumberOrUndefined(limits.rpmLimit)
		if (limits.tpmLimit !== undefined) this.tpmLimit = toPositiveNumberOrUndefined(limits.tpmLimit)
		if (limits.nearThreshold !== undefined) this.nearThreshold = clampNearThreshold(limits.nearThreshold)
	}

	async waitIfNeeded(estimatedTokens: number = 0): Promise<void> {
		await this.enqueue(async () => {
			const now = Date.now()
			this.prune(now)

			let waitMs = 0

			// RPM calculation: if we're at/over the near-threshold, wait until the oldest request falls out of the window
			if (isFiniteNumber(this.rpmLimit)) {
				const rpmUsed = this.requestTimes.length
				const rpmThreshold = Math.max(0, Math.floor(this.nearThreshold * (this.rpmLimit as number)))
				if (rpmUsed >= rpmThreshold && this.requestTimes.length > 0) {
					const oldest = this.requestTimes[0]
					const ms = oldest + this.windowMs - now + 1
					if (ms > waitMs) waitMs = ms
				}
			}

			// TPM calculation: if sumTokens in window exceeds (nearThreshold*tpmLimit - estimatedTokens),
			// compute time until enough oldest token events expire.
			if (isFiniteNumber(this.tpmLimit)) {
				const tpmLimit = this.tpmLimit as number
				const tpmThresholdTarget = Math.max(
					0,
					Math.floor(this.nearThreshold * tpmLimit) - Math.max(0, Math.floor(estimatedTokens)),
				)
				const { sumTokens, neededWaitMs } = this.computeTpmWait(now, tpmThresholdTarget)
				if (sumTokens > tpmThresholdTarget && neededWaitMs > waitMs) {
					waitMs = neededWaitMs
				}
			}

			if (waitMs > 0) {
				await delay(waitMs)
			}
		})
	}

	async onRequestStart(): Promise<void> {
		await this.enqueue(async () => {
			const now = Date.now()
			this.prune(now)
			this.requestTimes.push(now)
		})
	}

	async onUsage(deltaTokens: number): Promise<void> {
		if (!isFiniteNumber(deltaTokens) || deltaTokens <= 0) return
		await this.enqueue(async () => {
			const now = Date.now()
			this.prune(now)
			this.tokenEvents.push({ ts: now, delta: Math.floor(deltaTokens) })
		})
	}

	getStats(): { rpmUsed: number; tpmUsed: number; rpmLimit?: number; tpmLimit?: number } {
		const now = Date.now()
		this.prune(now)
		const rpmUsed = this.requestTimes.length
		const tpmUsed = this.tokenEvents.reduce((sum, e) => sum + e.delta, 0)
		return {
			rpmUsed,
			tpmUsed,
			rpmLimit: this.rpmLimit,
			tpmLimit: this.tpmLimit,
		}
	}

	// Computes how long (ms) until token usage decays to target or below.
	private computeTpmWait(now: number, target: number): { sumTokens: number; neededWaitMs: number } {
		if (!this.tokenEvents.length) return { sumTokens: 0, neededWaitMs: 0 }
		// tokenEvents are appended in ascending order of ts
		let sum = 0
		for (let i = 0; i < this.tokenEvents.length; i++) sum += this.tokenEvents[i].delta

		if (sum <= target) return { sumTokens: sum, neededWaitMs: 0 }

		let neededWaitMs = 0
		let curSum = sum
		for (let i = 0; i < this.tokenEvents.length && curSum > target; i++) {
			const ev = this.tokenEvents[i]
			curSum -= ev.delta
			const ms = ev.ts + this.windowMs - now + 1
			if (ms > neededWaitMs) neededWaitMs = ms
		}
		if (neededWaitMs < 0) neededWaitMs = 0
		return { sumTokens: sum, neededWaitMs }
	}

	private prune(now: number) {
		const cutoff = now - this.windowMs
		// Prune requestTimes
		let i = 0
		while (i < this.requestTimes.length && this.requestTimes[i] <= cutoff) i++
		if (i > 0) this.requestTimes.splice(0, i)

		// Prune tokenEvents
		let j = 0
		while (j < this.tokenEvents.length && this.tokenEvents[j].ts <= cutoff) j++
		if (j > 0) this.tokenEvents.splice(0, j)
	}

	private async enqueue(fn: () => Promise<void>): Promise<void> {
		// Chain onto the previous promise to serialize calls
		this.queue = this.queue.then(fn, fn)
		try {
			await this.queue
		} catch {
			// swallow errors inside limiter; external callers handle their own flow
		}
	}
}

function clampNearThreshold(v: number | undefined): number {
	if (!isFiniteNumber(v)) return 0.9
	// keep it within (0,1); enforce a small buffer from extremes
	const clamped = Math.max(0.01, Math.min(0.99, v as number))
	return clamped
}

function isFiniteNumber(v: any): v is number {
	return typeof v === "number" && Number.isFinite(v)
}

function toPositiveNumberOrUndefined(v: any): number | undefined {
	const n = Number(v)
	if (Number.isFinite(n) && n > 0) return n
	return undefined
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

export default SlidingWindowLimiter
