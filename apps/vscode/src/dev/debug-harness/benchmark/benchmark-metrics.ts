// Scroll/rendering benchmark metrics (V14 §2.6 / P2 "真实宿主 E2E Benchmark")
//
// Pure statistical helpers shared by the debug-harness benchmark script and
// its unit tests. Runtime-agnostic: they only consume frame duration samples
// (collected via requestAnimationFrame in the real webview) and memory
// samples (from performance.memory / process.memoryUsage).

export interface FrameSample {
	/** rAF timestamp in ms (performance.now()). */
	timestampMs: number
	/** Duration of this frame in ms. */
	frameDurationMs: number
}

export interface ScrollBenchmarkConfig {
	/** Frames longer than this (ms) count as janky. Default 50 (~20fps). */
	jankThresholdMs?: number
	/** Minimum acceptable p95 FPS for the benchmark to pass. Default 30. */
	minP95Fps?: number
	/** Maximum acceptable jank rate (0..1) for the benchmark to pass. Default 0.1. */
	maxJankRate?: number
}

export interface ScrollBenchmarkResult {
	totalFrames: number
	totalDurationMs: number
	avgFps: number
	minFps: number
	maxFps: number
	p95Fps: number
	jankyFrames: number
	jankRate: number
	pass: boolean
	summary: string
}

const DEFAULT_CONFIG: Required<ScrollBenchmarkConfig> = {
	jankThresholdMs: 50,
	minP95Fps: 30,
	maxJankRate: 0.1,
}

/** nth-percentile duration (0..100) of an ascending-sorted duration array. */
function percentile(sortedDurations: number[], p: number): number {
	if (sortedDurations.length === 0) {
		return 0
	}
	const index = Math.min(sortedDurations.length - 1, Math.ceil((p / 100) * sortedDurations.length) - 1)
	return sortedDurations[Math.max(0, index)]
}

/**
 * Compute FPS/jank statistics from rAF frame samples. Frames must be ordered
 * by timestamp (the collector emits them in order).
 */
export function computeScrollBenchmark(frames: FrameSample[], config: ScrollBenchmarkConfig = {}): ScrollBenchmarkResult {
	const cfg: Required<ScrollBenchmarkConfig> = { ...DEFAULT_CONFIG, ...config }

	const durations = frames.map((frame) => Math.max(0, frame.frameDurationMs))
	const sorted = [...durations].sort((a, b) => a - b)

	const totalFrames = durations.length
	const totalDurationMs = totalFrames > 0 ? durations.reduce((sum, d) => sum + d, 0) : 0
	const avgFps = totalDurationMs > 0 ? (totalFrames / totalDurationMs) * 1000 : 0
	const minFps = sorted.length > 0 ? 1000 / Math.max(sorted[sorted.length - 1], Number.EPSILON) : 0
	const maxFps = sorted.length > 0 ? 1000 / Math.max(sorted[0], Number.EPSILON) : 0
	const p95Duration = percentile(sorted, 95)
	const p95Fps = p95Duration > 0 ? 1000 / p95Duration : 0
	const jankyFrames = durations.filter((duration) => duration > cfg.jankThresholdMs).length
	const jankRate = totalFrames > 0 ? jankyFrames / totalFrames : 0

	const pass = p95Fps >= cfg.minP95Fps && jankRate <= cfg.maxJankRate
	const summary = `${totalFrames} frames over ${Math.round(totalDurationMs)}ms · avg ${avgFps.toFixed(1)}fps · p95 ${p95Fps.toFixed(1)}fps · min ${minFps.toFixed(1)}fps · jank ${jankRate.toFixed(3)} (${jankyFrames}/${totalFrames}) — ${pass ? "PASS" : "FAIL"}`

	return { totalFrames, totalDurationMs, avgFps, minFps, maxFps, p95Fps, jankyFrames, jankRate, pass, summary }
}

export interface MemorySample {
	usedMB: number
	timestampMs: number
}

export interface MemoryBudgetResult {
	peakMB: number
	avgMB: number
	withinBudget: boolean
	summary: string
}

/**
 * Check memory samples against a budget (V14 target: < 200MB on a 100+
 * message conversation scroll test).
 */
export function checkMemoryBudget(samples: MemorySample[], budgetMB: number): MemoryBudgetResult {
	const used = samples.map((sample) => sample.usedMB)
	const peakMB = used.length > 0 ? Math.max(...used) : 0
	const avgMB = used.length > 0 ? used.reduce((sum, value) => sum + value, 0) / used.length : 0
	const withinBudget = peakMB <= budgetMB
	const summary = `peak ${peakMB.toFixed(1)}MB / budget ${budgetMB}MB · avg ${avgMB.toFixed(1)}MB — ${withinBudget ? "PASS" : "FAIL"}`
	return { peakMB, avgMB, withinBudget, summary }
}
