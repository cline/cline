import { strict as assert } from "assert"
import { summarizeTaskLatencyEvents } from "../taskLatencySummary"

describe("taskLatencySummary", () => {
	it("summarizes averages and ranges across latency events", () => {
		const summary = summarizeTaskLatencyEvents([
			{
				ulid: "task-1",
				requestIndex: 1,
				presentationInvocationCount: 2,
				partialMessageCount: 4,
				statePostCount: 1,
				statePostSerializedBytes: 100,
				persistenceFlushCount: 1,
				chunkToWebviewMedianMs: 20,
				chunkToWebviewP95Ms: 35,
			},
			{
				ulid: "task-1",
				requestIndex: 2,
				presentationInvocationCount: 4,
				partialMessageCount: 6,
				statePostCount: 3,
				statePostSerializedBytes: 300,
				persistenceFlushCount: 2,
				chunkToWebviewMedianMs: 30,
				chunkToWebviewP95Ms: 45,
			},
		])

		assert.equal(summary.eventCount, 2)
		assert.equal(summary.requestCount, 2)
		assert.deepStrictEqual(summary.metrics.presentationInvocationCount, { average: 3, min: 2, max: 4 })
		assert.deepStrictEqual(summary.metrics.statePostSerializedBytes, { average: 200, min: 100, max: 300 })
		assert.deepStrictEqual(summary.metrics.chunkToWebviewP95Ms, { average: 40, min: 35, max: 45 })
	})

	it("returns zeroed summaries when events are empty or metrics are absent", () => {
		const summary = summarizeTaskLatencyEvents([{ ulid: "task-1", requestIndex: 1 }])
		assert.equal(summary.eventCount, 1)
		assert.equal(summary.requestCount, 1)
		assert.deepStrictEqual(summary.metrics.partialMessageCount, { average: 0, min: 0, max: 0 })

		const empty = summarizeTaskLatencyEvents([])
		assert.equal(empty.eventCount, 0)
		assert.equal(empty.requestCount, 0)
		assert.deepStrictEqual(empty.metrics.statePostCount, { average: 0, min: 0, max: 0 })
	})
})
