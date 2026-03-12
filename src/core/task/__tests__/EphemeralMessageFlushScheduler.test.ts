import { strict as assert } from "assert"
import { MessageStateHandler } from "../../task/message-state"
import { TaskState } from "../../task/TaskState"
import { EphemeralMessageFlushScheduler } from "../EphemeralMessageFlushScheduler"

class FakeIntervalController {
	private now = 0
	private nextId = 1
	private intervals = new Map<number, { delay: number; nextRunAt: number; callback: () => void }>()

	setInterval = (callback: () => void, delay: number) => {
		const id = this.nextId++
		this.intervals.set(id, { delay, nextRunAt: this.now + delay, callback })
		return id as unknown as ReturnType<typeof setInterval>
	}

	clearInterval = (handle: ReturnType<typeof setInterval>) => {
		this.intervals.delete(handle as unknown as number)
	}

	advance(ms: number) {
		this.now += ms
		let ran = true
		while (ran) {
			ran = false
			for (const [id, interval] of [...this.intervals.entries()].sort((a, b) => a[1].nextRunAt - b[1].nextRunAt)) {
				if (interval.nextRunAt <= this.now) {
					interval.callback()
					interval.nextRunAt += interval.delay
					this.intervals.set(id, interval)
					ran = true
				}
			}
		}
	}
}

describe("EphemeralMessageFlushScheduler", () => {
	function createHandler(): MessageStateHandler {
		return new MessageStateHandler({
			taskId: "test-task-id",
			ulid: "test-ulid",
			taskState: new TaskState(),
			updateTaskHistory: async () => [],
		})
	}

	it("periodically flushes pending ephemeral message changes", async () => {
		const timer = new FakeIntervalController()
		const handler = createHandler()
		const scheduler = new EphemeralMessageFlushScheduler({
			flush: async () => handler.flushClineMessagesAndUpdateHistory(),
			getDelayMs: () => 1500,
			setIntervalFn: timer.setInterval as typeof setInterval,
			clearIntervalFn: timer.clearInterval as typeof clearInterval,
		})

		await handler.addToClineMessagesEphemeral({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "streaming",
			partial: true,
		})

		assert.equal(handler.consumeLatencyMetrics().persistenceFlushCount, 0)

		scheduler.start()
		timer.advance(1499)
		await Promise.resolve()
		assert.equal(handler.consumeLatencyMetrics().persistenceFlushCount, 0)

		timer.advance(1)
		await Promise.resolve()
		await Promise.resolve()

		assert.equal(handler.consumeLatencyMetrics().persistenceFlushCount, 1)
	})

	it("stops scheduling future flushes after stop is called", async () => {
		const timer = new FakeIntervalController()
		let flushCount = 0
		const scheduler = new EphemeralMessageFlushScheduler({
			flush: async () => {
				flushCount += 1
			},
			getDelayMs: () => 100,
			setIntervalFn: timer.setInterval as typeof setInterval,
			clearIntervalFn: timer.clearInterval as typeof clearInterval,
		})

		scheduler.start()
		timer.advance(100)
		await Promise.resolve()
		assert.equal(flushCount, 1)

		scheduler.stop()
		timer.advance(500)
		await Promise.resolve()
		assert.equal(flushCount, 1)
	})
})
