import { describe, it } from "mocha"
import "should"
import {
	assertUtf8ByteBudget,
	diffProcessResourceSnapshots,
	measureAsyncOperation,
	measureUtf8Bytes,
	sampleEventLoopLagStats,
	takeProcessResourceSnapshot,
} from "./stress-utils"

describe("stress-utils", () => {
	it("measureUtf8Bytes should count ASCII and multi-byte UTF-8 content correctly", () => {
		measureUtf8Bytes("abc").should.equal(3)
		measureUtf8Bytes("🙂").should.equal(Buffer.byteLength("🙂", "utf8"))
		measureUtf8Bytes("a🙂b").should.equal(Buffer.byteLength("a🙂b", "utf8"))
	})

	it("assertUtf8ByteBudget should allow content within the budget", () => {
		;(() => assertUtf8ByteBudget("abcd", 4, "test payload")).should.not.throw()
	})

	it("assertUtf8ByteBudget should throw a readable error when budget is exceeded", () => {
		;(() => assertUtf8ByteBudget("abcde", 4, "test payload")).should.throw(/test payload exceeded UTF-8 byte budget/)
	})

	it("takeProcessResourceSnapshot should return process memory and active handle information", () => {
		const snapshot = takeProcessResourceSnapshot()
		snapshot.timestampMs.should.be.a.Number()
		snapshot.performanceNowMs.should.be.a.Number()
		snapshot.memory.heapUsed.should.be.a.Number()
		snapshot.memory.heapTotal.should.be.a.Number()
		snapshot.memory.rss.should.be.a.Number()
		snapshot.activeHandles.count.should.be.a.Number()
		snapshot.activeHandles.types.should.be.an.Array()
	})

	it("diffProcessResourceSnapshots should compute deltas between snapshots", () => {
		const before = {
			timestampMs: 1,
			performanceNowMs: 10,
			memory: { heapUsed: 10, heapTotal: 20, external: 30, arrayBuffers: 40, rss: 50 },
			activeHandles: { count: 1, types: ["Timeout"] },
		}
		const after = {
			timestampMs: 2,
			performanceNowMs: 25,
			memory: { heapUsed: 15, heapTotal: 22, external: 31, arrayBuffers: 45, rss: 60 },
			activeHandles: { count: 3, types: ["Timeout", "FSWatcher", "Socket"] },
		}

		const diff = diffProcessResourceSnapshots(before, after)
		diff.durationMs.should.equal(15)
		diff.heapUsedDelta.should.equal(5)
		diff.heapTotalDelta.should.equal(2)
		diff.externalDelta.should.equal(1)
		diff.arrayBuffersDelta.should.equal(5)
		diff.rssDelta.should.equal(10)
		diff.activeHandleCountDelta.should.equal(2)
		diff.activeHandleTypesAdded.should.deepEqual(["FSWatcher", "Socket"])
	})

	it("measureAsyncOperation should return result, duration, and resource snapshots", async function () {
		this.timeout(5000)

		const measured = await measureAsyncOperation("example operation", async () => {
			return 42
		})

		measured.label.should.equal("example operation")
		measured.result.should.equal(42)
		measured.durationMs.should.be.greaterThanOrEqual(0)
		measured.before.memory.heapUsed.should.be.a.Number()
		measured.after.memory.heapUsed.should.be.a.Number()
		measured.diff.durationMs.should.be.greaterThanOrEqual(0)
	})

	it("sampleEventLoopLagStats should return non-negative lag measurements", async function () {
		this.timeout(5000)

		const stats = await sampleEventLoopLagStats(40, 10)
		stats.runtimeMs.should.be.greaterThanOrEqual(0)
		stats.minMs.should.be.greaterThanOrEqual(0)
		stats.maxMs.should.be.greaterThanOrEqual(0)
		stats.meanMs.should.be.greaterThanOrEqual(0)
		stats.p50Ms.should.be.greaterThanOrEqual(0)
		stats.p95Ms.should.be.greaterThanOrEqual(0)
		stats.p99Ms.should.be.greaterThanOrEqual(0)
	})
})
