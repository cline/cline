import { describe, expect, it } from "vitest"
import { checkMemoryBudget, computeScrollBenchmark, type FrameSample } from "./benchmark-metrics"

function smoothFrames(count: number, durationMs = 16.7): FrameSample[] {
	return Array.from({ length: count }, (_, i) => ({ timestampMs: i * durationMs, frameDurationMs: durationMs }))
}

describe("computeScrollBenchmark", () => {
	it("reports ~60fps for smooth frames and passes", () => {
		const result = computeScrollBenchmark(smoothFrames(120, 16.7))
		expect(result.totalFrames).toBe(120)
		expect(result.avgFps).toBeGreaterThan(55)
		expect(result.avgFps).toBeLessThan(65)
		expect(result.p95Fps).toBeGreaterThan(55)
		expect(result.jankyFrames).toBe(0)
		expect(result.pass).toBe(true)
	})

	it("flags janky frames over the threshold", () => {
		const frames: FrameSample[] = [
			...smoothFrames(90, 16.7),
			{ timestampMs: 1500, frameDurationMs: 250 }, // long GC pause
			...smoothFrames(9, 16.7),
		]
		const result = computeScrollBenchmark(frames)
		expect(result.jankyFrames).toBe(1)
		expect(result.jankRate).toBeCloseTo(0.01, 2)
		expect(result.minFps).toBeLessThan(10)
	})

	it("fails when p95 fps drops below the minimum", () => {
		const frames = smoothFrames(60, 50) // 20fps sustained
		const result = computeScrollBenchmark(frames)
		expect(result.p95Fps).toBeLessThan(30)
		expect(result.pass).toBe(false)
	})

	it("fails when the jank rate exceeds the maximum", () => {
		const frames: FrameSample[] = Array.from({ length: 10 }, (_, i) => ({
			timestampMs: i * 100,
			frameDurationMs: 100,
		}))
		const result = computeScrollBenchmark(frames)
		expect(result.jankRate).toBe(1)
		expect(result.pass).toBe(false)
	})

	it("handles empty input without crashing", () => {
		const result = computeScrollBenchmark([])
		expect(result.totalFrames).toBe(0)
		expect(result.pass).toBe(false)
		expect(result.summary).toContain("0 frames")
	})

	it("respects a custom jank threshold", () => {
		const frames = smoothFrames(10, 30) // 33fps, fine for heavy content
		const strict = computeScrollBenchmark(frames, { jankThresholdMs: 25 })
		const lenient = computeScrollBenchmark(frames, { jankThresholdMs: 40 })
		expect(strict.jankyFrames).toBe(10)
		expect(lenient.jankyFrames).toBe(0)
	})
})

describe("checkMemoryBudget", () => {
	it("passes when peak stays under the budget", () => {
		const result = checkMemoryBudget(
			[
				{ usedMB: 120, timestampMs: 0 },
				{ usedMB: 150, timestampMs: 100 },
			],
			200,
		)
		expect(result.peakMB).toBe(150)
		expect(result.avgMB).toBe(135)
		expect(result.withinBudget).toBe(true)
	})

	it("fails when peak exceeds the budget", () => {
		const result = checkMemoryBudget([{ usedMB: 210, timestampMs: 0 }], 200)
		expect(result.withinBudget).toBe(false)
		expect(result.summary).toContain("FAIL")
	})

	it("handles empty samples", () => {
		const result = checkMemoryBudget([], 200)
		expect(result.peakMB).toBe(0)
		expect(result.withinBudget).toBe(true)
	})
})
