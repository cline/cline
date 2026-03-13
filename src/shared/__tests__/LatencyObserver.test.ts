import { strict as assert } from "assert"
import { describe, it } from "mocha"
import {
	createRollingLatencyStats,
	DEFAULT_LATENCY_OBSERVER_CAPABILITIES,
	type LatencyObserverMetricSet,
} from "@/shared/LatencyObserver"

describe("LatencyObserver", () => {
	it("aggregates rolling latency stats consistently", () => {
		const stats = createRollingLatencyStats([
			{ startedAt: 0, endedAt: 5, durationMs: 5 },
			{ startedAt: 10, endedAt: 18, durationMs: 8 },
			{ startedAt: 20, endedAt: 26, durationMs: 6 },
		])

		assert.deepStrictEqual(stats, {
			count: 3,
			minMs: 5,
			maxMs: 8,
			avgMs: 19 / 3,
			lastMs: 6,
			totalMs: 19,
		})
	})

	it("supports missing optional metrics without breaking the shared model", () => {
		const metricSet: LatencyObserverMetricSet = {
			transportSamples: [],
			taskInitializationSamples: [],
			firstVisibleUpdateSamples: [],
			capabilities: DEFAULT_LATENCY_OBSERVER_CAPABILITIES,
			session: {
				startedAt: 1,
			},
		}

		assert.equal(metricSet.optionalCounters, undefined)
		assert.deepStrictEqual(createRollingLatencyStats(metricSet.transportSamples), {
			count: 0,
			minMs: null,
			maxMs: null,
			avgMs: null,
			lastMs: null,
			totalMs: 0,
		})
	})
})
