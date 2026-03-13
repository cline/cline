import { strict as assert } from "assert"
import { describe, it } from "mocha"
import { LatencyObserverService } from "@/services/latency/LatencyObserverService"

describe("LatencyObserverService", () => {
	it("records task initialization and first visible update lifecycle", () => {
		const service = new LatencyObserverService()

		service.markTaskInitializationStart("task-1", 10)
		service.recordTaskInitializationEnd("task-1", 25)
		service.markRequestStart("task-1", "task-1:req-1", 30)
		service.recordFirstVisibleUpdate("task-1", "text", 42)
		service.completeRequest("task-1")

		const snapshot = service.getSnapshot()
		assert.equal(snapshot.taskInitialization.stats.count, 1)
		assert.equal(snapshot.taskInitialization.stats.lastMs, 15)
		assert.equal(snapshot.firstVisibleUpdate.stats.count, 1)
		assert.equal(snapshot.firstVisibleUpdate.stats.lastMs, 12)
		assert.equal(snapshot.logs.length >= 4, true)
	})

	it("records first visible update only once per request", () => {
		const service = new LatencyObserverService()

		service.markRequestStart("task-2", "task-2:req-1", 100)
		service.recordFirstVisibleUpdate("task-2", "text", 140)
		service.recordFirstVisibleUpdate("task-2", "reasoning", 150)

		const snapshot = service.getSnapshot()
		assert.equal(snapshot.firstVisibleUpdate.stats.count, 1)
		assert.equal(snapshot.firstVisibleUpdate.samples[0].label, "text")
	})

	it("tracks optional counters and session metadata", () => {
		const service = new LatencyObserverService()
		service.setSessionMetadata({ branch: "feature/latency", commit: "abc123", environment: "production", platform: "darwin" })
		service.incrementCounter("fullStatePushes")
		service.incrementCounter("fullStateBytes", 512)
		service.incrementCounter("partialMessageEvents", 2)
		service.incrementCounter("partialMessageBytes", 128)

		const snapshot = service.getSnapshot()
		assert.equal(snapshot.session.branch, "feature/latency")
		assert.equal(snapshot.session.commit, "abc123")
		assert.equal(snapshot.optionalCounters?.fullStatePushes, 1)
		assert.equal(snapshot.optionalCounters?.fullStateBytes, 512)
		assert.equal(snapshot.optionalCounters?.partialMessageEvents, 2)
		assert.equal(snapshot.optionalCounters?.partialMessageBytes, 128)
	})
})
