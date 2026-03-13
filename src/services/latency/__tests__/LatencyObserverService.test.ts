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
		service.recordFirstFullStateUpdate("task-1", 45)
		service.completeRequest("task-1")

		const snapshot = service.getSnapshot()
		assert.equal(snapshot.taskInitialization.stats.count, 1)
		assert.equal(snapshot.taskInitialization.stats.lastMs, 15)
		assert.equal(snapshot.firstVisibleUpdate.stats.count, 1)
		assert.equal(snapshot.firstVisibleUpdate.stats.lastMs, 12)
		assert.equal(snapshot.firstFullStateUpdate.stats.count, 1)
		assert.equal(snapshot.firstFullStateUpdate.stats.lastMs, 15)
		assert.equal(snapshot.logs.length >= 4, true)
	})

	it("records first full-state update only once per request", () => {
		const service = new LatencyObserverService()

		service.markRequestStart("task-fs", "task-fs:req-1", 100)
		service.recordFirstFullStateUpdate("task-fs", 125)
		service.recordFirstFullStateUpdate("task-fs", 140)

		const snapshot = service.getSnapshot()
		assert.equal(snapshot.firstFullStateUpdate.stats.count, 1)
		assert.equal(snapshot.firstFullStateUpdate.samples[0].durationMs, 25)
	})

	it("records first partial-message update only once per request", () => {
		const service = new LatencyObserverService()

		service.markRequestStart("task-pm", "task-pm:req-1", 100)
		service.recordFirstPartialMessageUpdate("task-pm", 118)
		service.recordFirstPartialMessageUpdate("task-pm", 140)

		const snapshot = service.getSnapshot()
		assert.equal(snapshot.firstPartialMessageUpdate.stats.count, 1)
		assert.equal(snapshot.firstPartialMessageUpdate.samples[0].durationMs, 18)
	})

	it("records chunk-to-webview delivery summaries", () => {
		const service = new LatencyObserverService()

		service.recordChunkToWebviewDelivery({
			startedAt: 200,
			endedAt: 212,
			durationMs: 12,
			label: "partial-message-broadcast",
			payloadBytes: 64,
		})

		const snapshot = service.getSnapshot()
		assert.equal(snapshot.chunkToWebview.stats.count, 1)
		assert.equal(snapshot.chunkToWebview.stats.lastMs, 12)
		assert.equal(snapshot.chunkToWebview.samples[0].payloadBytes, 64)
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

	it("captures per-request richer counter summaries on completion", () => {
		const service = new LatencyObserverService()

		service.markRequestStart("task-4", "task-4:req-1", 50)
		service.incrementCounter("fullStatePushes", 2)
		service.incrementCounter("fullStateBytes", 300)
		service.incrementCounter("partialMessageEvents", 3)
		service.incrementCounter("partialMessageBytes", 120)
		service.incrementCounter("taskUiDeltaEvents", 4)
		service.incrementCounter("persistenceFlushes", 1)
		service.completeRequest("task-4")

		const snapshot = service.getSnapshot()
		assert.equal(snapshot.requestCounterSummaries.length, 1)
		assert.deepEqual(snapshot.requestCounterSummaries[0], {
			requestId: "task-4:req-1",
			taskId: "task-4",
			startedAt: 50,
			completedAt: snapshot.requestCounterSummaries[0].completedAt,
			fullStatePushes: 2,
			fullStateBytes: 300,
			partialMessageEvents: 3,
			partialMessageBytes: 120,
			taskUiDeltaEvents: 4,
			persistenceFlushes: 1,
		})
	})

	it("uses capability support values in metric snapshots", () => {
		const service = new LatencyObserverService()

		service.setCapability("taskInitialization", "hook-not-installed")
		service.setCapability("requestStart", "unsupported")
		service.setCapability("firstVisibleUpdate", "hook-not-installed")
		service.setCapability("firstFullStateUpdate", "unsupported")
		service.setCapability("firstPartialMessageUpdate", "hook-not-installed")
		service.setCapability("chunkToWebviewTiming", "supported")

		const snapshot = service.getSnapshot()
		assert.equal(snapshot.taskInitialization.support, "hook-not-installed")
		assert.equal(snapshot.requestStart.support, "unsupported")
		assert.equal(snapshot.firstVisibleUpdate.support, "hook-not-installed")
		assert.equal(snapshot.firstFullStateUpdate.support, "unsupported")
		assert.equal(snapshot.firstPartialMessageUpdate.support, "hook-not-installed")
		assert.equal(snapshot.chunkToWebview.support, "supported")
	})

	it("reset clears recorded samples, counters, and logs for a fresh session", () => {
		const service = new LatencyObserverService()
		service.setSessionMetadata({ branch: "feature/latency", commit: "abc123", environment: "production" })
		const startedAtBeforeReset = service.getSnapshot().session.startedAt

		service.markTaskInitializationStart("task-3", 1)
		service.recordTaskInitializationEnd("task-3", 5)
		service.markRequestStart("task-3", "task-3:req-1", 6)
		service.recordFirstVisibleUpdate("task-3", "text", 10)
		service.incrementCounter("fullStatePushes", 2)
		service.completeRequest("task-3")

		service.reset()

		const snapshot = service.getSnapshot()
		assert.equal(snapshot.session.branch, "feature/latency")
		assert.equal(snapshot.session.commit, "abc123")
		assert.equal(snapshot.session.environment, "production")
		assert.equal(snapshot.session.startedAt >= startedAtBeforeReset, true)
		assert.equal(snapshot.taskInitialization.stats.count, 0)
		assert.equal(snapshot.requestStart.stats.count, 0)
		assert.equal(snapshot.firstVisibleUpdate.stats.count, 0)
		assert.equal(snapshot.firstFullStateUpdate.stats.count, 0)
		assert.equal(snapshot.firstPartialMessageUpdate.stats.count, 0)
		assert.equal(snapshot.chunkToWebview.stats.count, 0)
		assert.equal(snapshot.requestCounterSummaries.length, 0)
		assert.equal(snapshot.logs.length, 0)
		assert.equal(snapshot.optionalCounters?.fullStatePushes, 0)
	})
})
