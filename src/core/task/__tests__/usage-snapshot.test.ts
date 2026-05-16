import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { type ApiRequestUsageMetrics, applyUsageSnapshot } from "../usage"

describe("applyUsageSnapshot", () => {
	it("keeps the latest per-request usage snapshot instead of accumulating repeated chunks", () => {
		const metrics: ApiRequestUsageMetrics = {
			inputTokens: 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: undefined,
		}

		const firstDelta = applyUsageSnapshot(metrics, {
			inputTokens: 13_856,
			outputTokens: 133,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0.1,
		})
		const secondDelta = applyUsageSnapshot(metrics, {
			inputTokens: 13_856,
			outputTokens: 134,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0.11,
		})

		assert.deepEqual(metrics, {
			inputTokens: 13_856,
			outputTokens: 134,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0.11,
		})
		assert.deepEqual(firstDelta, {
			inputTokens: 13_856,
			outputTokens: 133,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0.1,
		})
		const { totalCost: secondDeltaCost, ...secondDeltaTokens } = secondDelta
		assert.deepEqual(secondDeltaTokens, {
			inputTokens: 0,
			outputTokens: 1,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		})
		assert.equal(Number(secondDeltaCost?.toFixed(2)), 0.01)
	})
})
