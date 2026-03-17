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

	it("reschedules an existing timer when a higher delayed priority is requested", () => {
		const clock = sinon.useFakeTimers()
		const flushSpy = sinon.spy(async () => {})

		const scheduler = new TaskPresentationScheduler({
			flush: flushSpy,
			getDelayMs: (priority) => (priority === "low" ? 100 : 10),
		})

		scheduler.requestFlush("low")
		clock.tick(20)
		scheduler.requestFlush("normal")

		clock.tick(9)
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

	it("rethrows errors from an overlapping in-flight flush when flushNow is called", async () => {
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

		const flushNowPromise = scheduler.flushNow()
		rejectFirstFlush?.(new Error("flush failed"))

		await flushNowPromise
			.then(() => {
				throw new Error("expected overlapping flushNow to reject")
			})
			.catch((error: Error) => {
				error.message.should.equal("flush failed")
			})
	})
})
