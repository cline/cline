import { expect } from "chai"
import { SlidingWindowLimiter } from "../SlidingWindowLimiter"

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms))
}

describe("SlidingWindowLimiter", () => {
	it("waitIfNeeded() dwells when TPM is near/exceeds threshold with estimate", async () => {
		// window 200ms for fast test feedback
		const limiter = new SlidingWindowLimiter({
			windowMs: 200,
			tpmLimit: 100,
			rpmLimit: 1000, // large so RPM doesn't affect
			nearThreshold: 0.9, // 90 tokens threshold in window
		})

		// Simulate prior token usage of 80 tokens within the window
		await limiter.onUsage(80)

		// We plan to send estimated 30 tokens which would push us well above 90 threshold
		const start = Date.now()
		await limiter.waitIfNeeded(30)
		const elapsed = Date.now() - start

		// We expect a dwell approximately equal to the window remaining time (~200ms).
		// Allow a generous lower bound to avoid flakiness in CI.
		expect(elapsed).to.be.gte(150)
	})

	it("onUsage() accumulates tokens and getStats() reflects current window", async () => {
		const limiter = new SlidingWindowLimiter({
			windowMs: 150,
			tpmLimit: 1000,
			rpmLimit: 1000,
			nearThreshold: 0.9,
		})

		await limiter.onUsage(10)
		await limiter.onUsage(15)
		let stats = limiter.getStats()
		expect(stats.tpmUsed).to.equal(25)

		// After window expiration, usage should prune out
		await sleep(170)
		stats = limiter.getStats()
		expect(stats.tpmUsed).to.equal(0)
	})
})
