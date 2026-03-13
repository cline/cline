import { strict as assert } from "assert"
import { Task } from "../index"

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
})
