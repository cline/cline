import { strict as assert } from "assert"
import { Task } from "../index"
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

describe("Task.scheduleAssistantPresentation", () => {
	function createTaskDouble() {
		const task = Object.create(Task.prototype) as any

		task.requestLatencyMetrics = {
			presentationInvocationCount: 0,
			presentationTrigger: undefined,
		}
		task.presentationSchedulingDisabled = false
		task.taskId = "task-test"

		return task
	}

	async function flushMicrotasks(iterations = 20) {
		for (let i = 0; i < iterations; i++) {
			await Promise.resolve()
		}
	}

	function createPresentationTaskDouble() {
		const task = createTaskDouble()
		const events: string[] = []

		task.taskState = {
			abort: false,
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [],
			didCompleteReadingStream: true,
			userMessageContentReady: false,
			didRejectTool: false,
			didAlreadyUseTool: false,
		} as any
		task.say = async (type: string, text?: string, _images?: unknown, _files?: unknown, _partial?: boolean) => {
			events.push(`${type}:${text ?? ""}`)
			return undefined
		}
		task.toolExecutor = {
			executeTool: async (block: { name: string }) => {
				events.push(`tool:${block.name}`)
			},
		} as any
		task.isParallelToolCallingEnabled = () => true
		task.initialCheckpointCommitPromise = undefined

		return { task, events }
	}

	it("increments request metrics and routes scheduled work through the scheduler", () => {
		const task = createTaskDouble()
		const requestedPriorities: string[] = []
		let flushedImmediately = 0

		task.presentationScheduler = {
			requestFlush: (priority: string) => {
				requestedPriorities.push(priority)
			},
		}
		task.flushAssistantPresentation = async () => {
			flushedImmediately += 1
		}

		task.scheduleAssistantPresentation("text", "normal")

		assert.equal(task.requestLatencyMetrics.presentationInvocationCount, 1)
		assert.equal(task.requestLatencyMetrics.presentationTrigger, "text")
		assert.deepStrictEqual(requestedPriorities, ["normal"])
		assert.equal(flushedImmediately, 0)
	})

	it("scheduling-disabled mode still drains immediately", async () => {
		const task = createTaskDouble()
		let scheduledFlushes = 0
		let flushedImmediately = 0

		task.presentationSchedulingDisabled = true
		task.presentationScheduler = {
			requestFlush: () => {
				scheduledFlushes += 1
			},
		}
		task.flushAssistantPresentation = async () => {
			flushedImmediately += 1
		}

		task.scheduleAssistantPresentation("tool", "immediate")
		await Promise.resolve()

		assert.equal(task.requestLatencyMetrics.presentationInvocationCount, 1)
		assert.equal(task.requestLatencyMetrics.presentationTrigger, "tool")
		assert.equal(flushedImmediately, 1)
		assert.equal(scheduledFlushes, 0)
	})

	it("coalesces many scheduled text updates into fewer flushes than request count", async () => {
		const timer = new FakeTimerController()
		const task = createTaskDouble()
		let flushCount = 0

		task.presentationScheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount += 1
			},
			getDelayMs: () => 50,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})
		task.flushAssistantPresentation = async () => {
			flushCount += 1
		}

		for (let i = 0; i < 5; i++) {
			task.scheduleAssistantPresentation("text", "normal")
		}

		assert.equal(task.requestLatencyMetrics.presentationInvocationCount, 5)
		assert.equal(flushCount, 0)

		timer.advance(50)
		await flushMicrotasks()

		assert.equal(flushCount, 1)
		assert.ok(flushCount < task.requestLatencyMetrics.presentationInvocationCount)
	})

	it("treats the first visible token and tool transitions as immediate-priority boundaries", () => {
		const task = createTaskDouble()

		assert.equal(task.getPresentationPriorityForChunk({ chunkType: "text", hadVisibleAssistantContent: false }), "immediate")
		assert.equal(
			task.getPresentationPriorityForChunk({ chunkType: "tool_calls", hadVisibleAssistantContent: true }),
			"immediate",
		)
		assert.equal(task.getPresentationPriorityForChunk({ chunkType: "reasoning", hadVisibleAssistantContent: true }), "normal")
	})

	it("flushes immediate-priority first-token presentations without waiting for cadence timers", async () => {
		const timer = new FakeTimerController()
		const task = createTaskDouble()
		let flushCount = 0

		task.presentationScheduler = new TaskPresentationScheduler({
			flush: async () => {
				flushCount += 1
			},
			getDelayMs: (priority) => (priority === "immediate" ? 0 : 50),
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})
		task.flushAssistantPresentation = async () => {
			flushCount += 1
		}

		task.scheduleAssistantPresentation("text", "immediate")
		await flushMicrotasks()

		assert.equal(flushCount, 1)
	})

	it("preserves text-before-tool execution order when draining presented content", async () => {
		const { task, events } = createPresentationTaskDouble()
		task.taskState.assistantMessageContent = [
			{ type: "text", content: "hello", partial: false },
			{ type: "tool_use", name: "read_file", partial: false, input: {} },
		]

		await task.presentAssistantMessage()

		assert.deepStrictEqual(events, ["text:hello", "tool:read_file"])
		assert.equal(task.taskState.userMessageContentReady, true)
	})

	it("flushNow presents final text before the next request can proceed", async () => {
		const timer = new FakeTimerController()
		const { task, events } = createPresentationTaskDouble()
		task.taskState.assistantMessageContent = [{ type: "text", content: "final answer", partial: false }]

		task.presentationScheduler = new TaskPresentationScheduler({
			flush: async () => {
				await task.presentAssistantMessage()
			},
			getDelayMs: () => 50,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})

		task.scheduleAssistantPresentation("text", "normal")
		assert.equal(task.taskState.userMessageContentReady, false)

		await task.presentationScheduler.flushNow()

		assert.deepStrictEqual(events, ["text:final answer"])
		assert.equal(task.taskState.userMessageContentReady, true)
		assert.equal(task.taskState.currentStreamingContentIndex, 1)
	})

	it("shows meaningfully higher presentation activity when scheduling is disabled for the same burst workload", async () => {
		const timer = new FakeTimerController()
		const scheduledTask = createTaskDouble()
		const immediateTask = createTaskDouble()
		let scheduledFlushCount = 0
		let immediateFlushCount = 0

		scheduledTask.presentationScheduler = new TaskPresentationScheduler({
			flush: async () => {
				scheduledFlushCount += 1
			},
			getDelayMs: () => 50,
			setTimeoutFn: timer.setTimeout as typeof setTimeout,
			clearTimeoutFn: timer.clearTimeout as typeof clearTimeout,
			getNow: timer.getNow,
		})
		scheduledTask.flushAssistantPresentation = async () => {
			scheduledFlushCount += 1
		}

		immediateTask.presentationSchedulingDisabled = true
		immediateTask.presentationScheduler = {
			requestFlush: () => undefined,
		}
		immediateTask.flushAssistantPresentation = async () => {
			immediateFlushCount += 1
		}

		for (let i = 0; i < 5; i++) {
			scheduledTask.scheduleAssistantPresentation("text", "normal")
			immediateTask.scheduleAssistantPresentation("text", "normal")
		}

		await flushMicrotasks()
		timer.advance(50)
		await flushMicrotasks()

		assert.equal(scheduledFlushCount, 1)
		assert.equal(immediateFlushCount, 5)
		assert.ok(immediateFlushCount > scheduledFlushCount)
	})
})
