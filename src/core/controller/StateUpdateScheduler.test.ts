import { strict as assert } from "assert"
import { describe, it } from "mocha"
import { StateUpdateScheduler } from "./StateUpdateScheduler"

describe("StateUpdateScheduler", () => {
	it("coalesces repeated normal-priority requests into one flush", async () => {
		let flushCount = 0
		let scheduledCallback: (() => void) | undefined
		const scheduler = new StateUpdateScheduler({
			flush: async () => {
				flushCount += 1
			},
			getDelayMs: () => 25,
			setTimeoutFn: ((callback: () => void) => {
				scheduledCallback = callback
				return 1 as any
			}) as typeof setTimeout,
			clearTimeoutFn: (() => {}) as typeof clearTimeout,
		})

		scheduler.requestFlush("normal")
		scheduler.requestFlush("normal")
		scheduler.requestFlush("low")

		assert.equal(flushCount, 0)
		assert.ok(scheduledCallback)
		scheduledCallback?.()
		await Promise.resolve()

		assert.equal(flushCount, 1)
	})

	it("flushes immediately when requested", async () => {
		let flushCount = 0
		let timerCleared = false
		const scheduler = new StateUpdateScheduler({
			flush: async () => {
				flushCount += 1
			},
			getDelayMs: () => 25,
			setTimeoutFn: (() => 1 as any) as typeof setTimeout,
			clearTimeoutFn: (() => {
				timerCleared = true
			}) as typeof clearTimeout,
		})

		scheduler.requestFlush("normal")
		await scheduler.flushNow()

		assert.equal(timerCleared, true)
		assert.equal(flushCount, 1)
	})

	it("runs one follow-up flush when updates arrive during an active flush", async () => {
		let flushCount = 0
		let releaseFlush: (() => void) | undefined
		const scheduler = new StateUpdateScheduler({
			flush: async () => {
				flushCount += 1
				if (flushCount === 1) {
					await new Promise<void>((resolve) => {
						releaseFlush = resolve
					})
				}
			},
			getDelayMs: () => 0,
		})

		const firstFlush = scheduler.flushNow()
		scheduler.requestFlush("normal")
		releaseFlush?.()
		await firstFlush
		await Promise.resolve()
		await Promise.resolve()

		assert.equal(flushCount, 2)
	})

	it("dispose clears scheduled work", async () => {
		let flushCount = 0
		let timerCleared = false
		const scheduler = new StateUpdateScheduler({
			flush: async () => {
				flushCount += 1
			},
			getDelayMs: () => 10,
			setTimeoutFn: (() => 1 as any) as typeof setTimeout,
			clearTimeoutFn: (() => {
				timerCleared = true
			}) as typeof clearTimeout,
		})

		scheduler.requestFlush("normal")
		await scheduler.dispose()
		await scheduler.flushNow()

		assert.equal(timerCleared, true)
		assert.equal(flushCount, 0)
	})
})