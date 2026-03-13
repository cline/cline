import { strict as assert } from "assert"
import { describe, it } from "mocha"
import { StateUpdateScheduler } from "./StateUpdateScheduler"

class FakeTimerController {
	private now = 0
	private nextId = 1
	private timers = new Map<number, { time: number; callback: () => void }>()

	setTimeout = (callback: () => void, delay: number) => {
		const id = this.nextId++
		this.timers.set(id, { time: this.now + delay, callback })
		return id as unknown as ReturnType<typeof setTimeout>
	}

	clearTimeout = (handle: ReturnType<typeof setTimeout>) => {
		this.timers.delete(handle as unknown as number)
	}

	advance(ms: number) {
		this.now += ms
		let ran = true
		while (ran) {
			ran = false
			for (const [id, timer] of [...this.timers.entries()].sort((a, b) => a[1].time - b[1].time)) {
				if (timer.time <= this.now) {
					this.timers.delete(id)
					timer.callback()
					ran = true
				}
			}
		}
	}

	getNow = () => this.now
}

describe("StateUpdateScheduler", () => {
	it("reduces flush count for bursty normal-priority updates compared with immediate flushes", async () => {
		const immediateTimer = new FakeTimerController()
		let immediateFlushCount = 0
		const immediateScheduler = new StateUpdateScheduler({
			flush: async () => {
				immediateFlushCount += 1
			},
			getDelayMs: () => 0,
			setTimeoutFn: immediateTimer.setTimeout as typeof setTimeout,
			clearTimeoutFn: immediateTimer.clearTimeout as typeof clearTimeout,
			getNow: immediateTimer.getNow,
		})

		for (let i = 0; i < 6; i++) {
			await immediateScheduler.flushNow()
		}

		const coalescedTimer = new FakeTimerController()
		let coalescedFlushCount = 0
		const coalescedScheduler = new StateUpdateScheduler({
			flush: async () => {
				coalescedFlushCount += 1
			},
			getDelayMs: () => 25,
			setTimeoutFn: coalescedTimer.setTimeout as typeof setTimeout,
			clearTimeoutFn: coalescedTimer.clearTimeout as typeof clearTimeout,
			getNow: coalescedTimer.getNow,
		})

		for (let i = 0; i < 6; i++) {
			coalescedScheduler.requestFlush("normal")
			coalescedTimer.advance(5)
			await Promise.resolve()
		}

		coalescedTimer.advance(25)
		await Promise.resolve()

		assert.equal(immediateFlushCount, 6)
		assert.equal(coalescedFlushCount, 2)
		assert.ok(coalescedFlushCount < immediateFlushCount)
	})

	it("coalesces more aggressively with remote cadence than with local cadence under the same burst", async () => {
		const runBurst = async (delayMs: number) => {
			const timer = new FakeTimerController()
			let flushCount = 0
			const scheduler = new StateUpdateScheduler({
				flush: async () => {
					flushCount += 1
				},
				getDelayMs: () => delayMs,
				setTimeoutFn: timer.setTimeout as typeof setTimeout,
				clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
				getNow: timer.getNow,
			})

			for (let i = 0; i < 8; i++) {
				scheduler.requestFlush("normal")
				timer.advance(20)
				await Promise.resolve()
			}

			timer.advance(delayMs)
			await Promise.resolve()
			return flushCount
		}

		const localFlushCount = await runBurst(16)
		const remoteFlushCount = await runBurst(110)

		assert.equal(localFlushCount, 8)
		assert.equal(remoteFlushCount, 2)
		assert.ok(remoteFlushCount < localFlushCount)
	})

	it("coalesces repeated normal-priority requests into one flush", async () => {
		const timer = new FakeTimerController()
		let flushCount = 0
		const scheduler = new StateUpdateScheduler({
			flush: async () => {
				flushCount += 1
			},
			getDelayMs: () => 50,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})

		scheduler.requestFlush("normal")
		scheduler.requestFlush("normal")
		scheduler.requestFlush("low")

		assert.equal(flushCount, 0)
		timer.advance(49)
		assert.equal(flushCount, 0)
		timer.advance(1)
		await Promise.resolve()

		assert.equal(flushCount, 1)
	})

	it("flushes immediately when requested", async () => {
		const timer = new FakeTimerController()
		let flushCount = 0
		const scheduler = new StateUpdateScheduler({
			flush: async () => {
				flushCount += 1
			},
			getDelayMs: () => 50,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})

		scheduler.requestFlush("normal")
		await scheduler.flushNow()

		assert.equal(flushCount, 1)
		timer.advance(100)
		await Promise.resolve()
		assert.equal(flushCount, 1)
	})

	it("runs one follow-up flush when updates arrive during an active flush", async () => {
		const timer = new FakeTimerController()
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
			getDelayMs: () => 10,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})

		scheduler.requestFlush("normal")
		timer.advance(10)
		await Promise.resolve()
		assert.equal(flushCount, 1)

		scheduler.requestFlush("normal")
		releaseFlush?.()
		await Promise.resolve()
		await Promise.resolve()
		timer.advance(10)
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
			setTimeoutFn: (() => 1 as any) as unknown as typeof setTimeout,
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

	it("does not schedule a follow-up flush after disposal during an active flush", async () => {
		const timer = new FakeTimerController()
		let flushCount = 0
		let resolveFlush: (() => void) | undefined
		const scheduler = new StateUpdateScheduler({
			flush: async () => {
				flushCount += 1
				await new Promise<void>((resolve) => {
					resolveFlush = resolve
				})
			},
			getDelayMs: () => 10,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})

		scheduler.requestFlush("normal")
		timer.advance(10)
		await Promise.resolve()
		assert.equal(flushCount, 1)

		scheduler.requestFlush("normal")
		await scheduler.dispose()
		resolveFlush?.()
		await Promise.resolve()
		await Promise.resolve()
		timer.advance(20)
		await Promise.resolve()
		assert.equal(flushCount, 1)
	})

	it("flushNow drains pending updates immediately after the current flush completes", async () => {
		const timer = new FakeTimerController()
		let flushCount = 0
		let resolveFlush: (() => void) | undefined
		const scheduler = new StateUpdateScheduler({
			flush: async () => {
				flushCount += 1
				await new Promise<void>((resolve) => {
					resolveFlush = resolve
				})
			},
			getDelayMs: () => 25,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})

		scheduler.requestFlush("normal")
		timer.advance(25)
		await Promise.resolve()
		assert.equal(flushCount, 1)

		scheduler.requestFlush("normal")
		const drainPromise = scheduler.flushNow()
		resolveFlush?.()
		await Promise.resolve()
		await Promise.resolve()
		assert.equal(flushCount, 2)

		resolveFlush?.()
		await drainPromise
		timer.advance(50)
		await Promise.resolve()
		assert.equal(flushCount, 2)
	})
})
