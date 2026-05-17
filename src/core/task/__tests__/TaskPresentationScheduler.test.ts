import { describe, it } from "mocha"
import "should"
import sinon from "sinon"

import { TaskPresentationScheduler } from "../TaskPresentationScheduler"

describe("TaskPresentationScheduler", () => {
	it("rethrows flush errors from flushNow so callers do not hang on hidden failures", async () => {
		const scheduler = new TaskPresentationScheduler({
			flush: async () => {
				throw new Error("flush failed")
			},
			getDelayMs: () => 10,
		})

		await scheduler
			.flushNow()
			.then(() => {
				throw new Error("expected flushNow to reject")
			})
			.catch((error: Error) => {
				error.message.should.equal("flush failed")
			})
	})

	it("coalesces multiple normal-priority requests into a single timer", () => {
		const clock = sinon.useFakeTimers()
		const flushSpy = sinon.spy(async () => {})

		const scheduler = new TaskPresentationScheduler({
			flush: flushSpy,
			getDelayMs: () => 50,
		})

		scheduler.requestFlush("normal")
		scheduler.requestFlush("normal")
		scheduler.requestFlush("normal")

		clock.tick(49)
		flushSpy.callCount.should.equal(0)

		clock.tick(1)
		flushSpy.callCount.should.equal(1)

		clock.restore()
	})

	it("waits for an in-flight flush and runs the requested immediate flush before resolving flushNow", async () => {
		let resolveFirstFlush: (() => void) | undefined
		let flushCount = 0

		const scheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount += 1
				if (flushCount === 1) {
					await new Promise<void>((resolve) => {
						resolveFirstFlush = resolve
					})
				}
			},
			getDelayMs: () => 0,
		})

		scheduler.requestFlush("immediate")
		await Promise.resolve()

		let didResolve = false
		const flushNowPromise = scheduler.flushNow().then(() => {
			didResolve = true
		})

		await Promise.resolve()
		flushCount.should.equal(1)
		didResolve.should.equal(false)

		resolveFirstFlush?.()
		await flushNowPromise

		flushCount.should.equal(2)
		didResolve.should.equal(true)
	})

	it("does not rethrow errors from an overlapping in-flight flush when flushNow is called", async () => {
		let rejectFirstFlush: ((error: Error) => void) | undefined
		let flushCount = 0

		const scheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount += 1
				if (flushCount === 1) {
					await new Promise<void>((_, reject) => {
						rejectFirstFlush = reject
					})
				}
			},
			getDelayMs: () => 0,
		})

		scheduler.requestFlush("immediate")
		await Promise.resolve()

		let flushNowResolved = false
		const flushNowPromise = scheduler.flushNow().then(() => {
			flushNowResolved = true
		})
		rejectFirstFlush?.(new Error("flush failed"))

		await flushNowPromise
		flushNowResolved.should.equal(true)
		flushCount.should.equal(2)
	})

	it("flushNow guarantees a flush even when the post-flush continuation consumed pendingPriority", async () => {
		// Regression test for the race condition where:
		// 1. A timer fires → runFlushCycle starts, sets flushInProgress=true, clears pendingPriority
		// 2. flushNow() is called → sets pendingPriority="immediate", enters runFlushCycle
		// 3. runFlushCycle sees flushInProgress, awaits currentFlushCompletion
		// 4. In-flight flush completes → post-flush continuation sees pendingPriority="immediate",
		//    calls runFlushCycle recursively → clears pendingPriority, runs flush #2
		// 5. flushNow()'s runFlushCycle resumes → pendingPriority is now undefined → would return
		//    without flushing (the bug)
		//
		// The fix: flushNow() waits for all in-flight flushes to drain *before* setting
		// pendingPriority, so the continuation cannot steal it.

		let resolveFirstFlush: (() => void) | undefined
		let flushCount = 0

		const scheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount += 1
				if (flushCount === 1) {
					// First flush: pause so flushNow() arrives while it's in-flight
					await new Promise<void>((resolve) => {
						resolveFirstFlush = resolve
					})
				}
			},
			getDelayMs: () => 0,
		})

		// Start the first flush (via immediate requestFlush)
		scheduler.requestFlush("immediate")
		// Yield so the async flush body starts executing
		await Promise.resolve()
		await Promise.resolve()

		// flushNow() is called while flush #1 is paused mid-execution
		let flushNowResolved = false
		const flushNowPromise = scheduler.flushNow().then(() => {
			flushNowResolved = true
		})

		// Unblock flush #1
		resolveFirstFlush?.()
		await flushNowPromise

		// flushNow must have triggered a second flush after flush #1 completed
		flushNowResolved.should.equal(true)
		flushCount.should.equal(2)
	})

	it("runs an immediate follow-up flush requested during an in-flight flush", async () => {
		let resolveFirstFlush: (() => void) | undefined
		let flushCount = 0

		const scheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount += 1
				if (flushCount === 1) {
					await new Promise<void>((resolve) => {
						resolveFirstFlush = resolve
					})
				}
			},
			getDelayMs: () => 0,
		})

		scheduler.requestFlush("immediate")
		await Promise.resolve()
		await Promise.resolve()

		scheduler.requestFlush("immediate")
		resolveFirstFlush?.()

		await scheduler.flushNow()
		flushCount.should.equal(3)
	})

	it("reset() cancels pending timers without marking the scheduler as disposed", () => {
		const clock = sinon.useFakeTimers()
		const flushSpy = sinon.spy(async () => {})

		const scheduler = new TaskPresentationScheduler({
			flush: flushSpy,
			getDelayMs: () => 50,
		})

		scheduler.requestFlush("normal")
		scheduler.reset()

		// The pending timer should have been cancelled
		clock.tick(100)
		flushSpy.callCount.should.equal(0)

		// Scheduler should still be usable after reset (not disposed)
		scheduler.requestFlush("normal")
		clock.tick(50)
		flushSpy.callCount.should.equal(1)

		clock.restore()
	})

	it("immediate priority bypasses the timer and flushes synchronously", () => {
		const clock = sinon.useFakeTimers()
		const flushSpy = sinon.spy(async () => {})

		const scheduler = new TaskPresentationScheduler({
			flush: flushSpy,
			getDelayMs: () => 100,
		})

		scheduler.requestFlush("immediate")
		// immediate fires via void runFlushCycle, which starts synchronously
		flushSpy.callCount.should.equal(1)

		clock.restore()
	})

	it("upgrades a pending normal timer to immediate when immediate is requested", () => {
		const clock = sinon.useFakeTimers()
		const flushSpy = sinon.spy(async () => {})

		const scheduler = new TaskPresentationScheduler({
			flush: flushSpy,
			getDelayMs: () => 100,
		})

		scheduler.requestFlush("normal")
		clock.tick(50)
		flushSpy.callCount.should.equal(0)

		// Upgrade to immediate — should cancel the timer and flush now
		scheduler.requestFlush("immediate")
		flushSpy.callCount.should.equal(1)

		// Original timer should not fire again
		clock.tick(100)
		flushSpy.callCount.should.equal(1)

		clock.restore()
	})
})
