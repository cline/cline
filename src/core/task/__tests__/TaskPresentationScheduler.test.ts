import { strict as assert } from "assert"
import { TaskPresentationScheduler } from "../TaskPresentationScheduler"

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

describe("TaskPresentationScheduler", () => {
	it("coalesces multiple requests within the cadence window into one flush", async () => {
		const timer = new FakeTimerController()
		let flushCount = 0
		const scheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount++
			},
			getDelayMs: () => 50,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})

		scheduler.requestFlush("normal")
		scheduler.requestFlush("normal")
		scheduler.requestFlush("low")
		timer.advance(49)
		assert.equal(flushCount, 0)
		timer.advance(1)
		await Promise.resolve()
		assert.equal(flushCount, 1)
	})

	it("immediate flush preempts scheduled normal work", async () => {
		const timer = new FakeTimerController()
		let flushCount = 0
		const scheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount++
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

	it("runs one follow-up flush when new work arrives during an active flush", async () => {
		const timer = new FakeTimerController()
		let flushCount = 0
		let resolveFlush: (() => void) | undefined
		const scheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount++
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
		resolveFlush?.()
		await Promise.resolve()
		await Promise.resolve()
		timer.advance(10)
		await Promise.resolve()
		assert.equal(flushCount, 2)
	})

	it("disposes pending work", async () => {
		const timer = new FakeTimerController()
		let flushCount = 0
		const scheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount++
			},
			getDelayMs: () => 50,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})

		scheduler.requestFlush("normal")
		await scheduler.dispose()
		timer.advance(100)
		await Promise.resolve()
		assert.equal(flushCount, 0)
	})

	it("does not schedule a follow-up flush after disposal during an active flush", async () => {
		const timer = new FakeTimerController()
		let flushCount = 0
		let resolveFlush: (() => void) | undefined
		const scheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount++
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
})
