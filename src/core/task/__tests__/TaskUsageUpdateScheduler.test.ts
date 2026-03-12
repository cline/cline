import { strict as assert } from "assert"
import { TaskUsageUpdateScheduler } from "../TaskUsageUpdateScheduler"

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
}

describe("TaskUsageUpdateScheduler", () => {
	it("coalesces many usage chunks into fewer UI flushes than chunk count", async () => {
		const flushMicrotasks = async (iterations = 20) => {
			for (let i = 0; i < iterations; i++) {
				await Promise.resolve()
			}
		}

		const timer = new FakeTimerController()
		let sideEffectCount = 0
		let uiFlushCount = 0
		const scheduler = new TaskUsageUpdateScheduler({
			getDelayMs: () => 50,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
		})

		for (let i = 0; i < 5; i++) {
			scheduler.enqueue({
				sideEffect: async () => {
					sideEffectCount += 1
				},
				flushUi: async () => {
					uiFlushCount += 1
				},
			})
		}

		await flushMicrotasks()
		assert.equal(uiFlushCount, 0)
		assert.equal(sideEffectCount, 5)

		timer.advance(50)
		await flushMicrotasks()

		assert.equal(sideEffectCount, 5)
		assert.equal(uiFlushCount, 1)
		assert.ok(uiFlushCount < sideEffectCount)
	})

	it("flushFinal immediately emits the final UI update after queued side effects complete", async () => {
		const timer = new FakeTimerController()
		const events: string[] = []
		const scheduler = new TaskUsageUpdateScheduler({
			getDelayMs: () => 100,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
		})

		scheduler.enqueue({
			sideEffect: async () => {
				events.push("side-effect")
			},
			flushUi: async () => {
				events.push("debounced-ui")
			},
		})

		await scheduler.flushFinal(async () => {
			events.push("final-ui")
		})

		assert.deepStrictEqual(events, ["side-effect", "final-ui"])

		timer.advance(200)
		await Promise.resolve()
		assert.deepStrictEqual(events, ["side-effect", "final-ui"])
	})
})
