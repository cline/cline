import { describe, it } from "mocha"
import "should"
import { InGenerationLoopDetector } from "../InGenerationLoopDetector"

describe("InGenerationLoopDetector", () => {
	function createDetector(opts: { charThreshold?: number; timeThresholdMs?: number; startTime?: number } = {}) {
		let currentTime = opts.startTime ?? 0
		const now = () => currentTime
		const advance = (ms: number) => {
			currentTime += ms
		}
		const detector = new InGenerationLoopDetector(opts.charThreshold ?? 15_000, opts.timeThresholdMs ?? 60_000, now)
		return { detector, advance }
	}

	it("should not trigger when under both thresholds", () => {
		const { detector, advance } = createDetector()
		detector.onTextChunk(5_000)
		advance(30_000)
		detector.isLooping().should.be.false()
	})

	it("should not trigger when only char threshold is exceeded", () => {
		const { detector, advance } = createDetector()
		detector.onTextChunk(20_000)
		advance(30_000) // under 60s
		detector.isLooping().should.be.false()
	})

	it("should not trigger when only time threshold is exceeded", () => {
		const { detector, advance } = createDetector()
		detector.onTextChunk(5_000) // under 15K
		advance(90_000)
		detector.isLooping().should.be.false()
	})

	it("should trigger when both thresholds are exceeded", () => {
		const { detector, advance } = createDetector()
		detector.onTextChunk(16_000)
		advance(61_000)
		detector.isLooping().should.be.true()
	})

	it("should accumulate text across multiple chunks", () => {
		const { detector, advance } = createDetector()
		for (let i = 0; i < 20; i++) {
			detector.onTextChunk(1_000) // 20 × 1K = 20K total
		}
		advance(61_000)
		detector.isLooping().should.be.true()
	})

	it("should reset on tool activity", () => {
		const { detector, advance } = createDetector()
		detector.onTextChunk(16_000)
		advance(61_000)
		// Would trigger, but tool activity resets everything
		detector.onToolActivity()
		detector.isLooping().should.be.false()
	})

	it("should reset char count on tool activity but re-accumulate after", () => {
		const { detector, advance } = createDetector()
		detector.onTextChunk(16_000)
		advance(30_000)
		detector.onToolActivity() // resets both trackers
		advance(61_000)
		detector.onTextChunk(5_000) // only 5K since reset
		detector.isLooping().should.be.false()
	})

	it("should trigger after tool activity if new text exceeds thresholds", () => {
		const { detector, advance } = createDetector()
		detector.onTextChunk(16_000)
		detector.onToolActivity() // resets
		advance(61_000)
		detector.onTextChunk(16_000) // new text exceeds threshold
		detector.isLooping().should.be.true()
	})

	it("should work with custom thresholds", () => {
		const { detector, advance } = createDetector({
			charThreshold: 100,
			timeThresholdMs: 1_000,
		})
		detector.onTextChunk(101)
		advance(1_001)
		detector.isLooping().should.be.true()
	})

	it("should reset timer on reasoning activity without clearing char count", () => {
		const { detector, advance } = createDetector()
		detector.onTextChunk(16_000)
		advance(90_000) // 90s of reasoning
		detector.onReasoningActivity() // resets timer but keeps 16K chars
		advance(30_000) // only 30s since reasoning reset
		detector.isLooping().should.be.false()
	})

	it("should trigger after reasoning if text continues long enough", () => {
		const { detector, advance } = createDetector()
		advance(90_000) // 90s of reasoning
		detector.onReasoningActivity()
		detector.onTextChunk(16_000)
		advance(61_000) // 61s since reasoning ended
		detector.isLooping().should.be.true()
	})

	it("should not trigger at exact boundary values", () => {
		const { detector, advance } = createDetector({
			charThreshold: 100,
			timeThresholdMs: 1_000,
		})
		detector.onTextChunk(100) // exactly at, not over
		advance(1_000) // exactly at, not over
		detector.isLooping().should.be.false()
	})
})
