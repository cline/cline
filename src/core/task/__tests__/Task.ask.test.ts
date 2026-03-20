import { strict as assert } from "node:assert"
import { Task } from "@core/task"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, it } from "mocha"
import sinon from "sinon"

async function flushMicrotasks(iterations = 5) {
	for (let i = 0; i < iterations; i++) {
		await Promise.resolve()
	}
}

function createFakeTask(taskState: {
	abort: boolean
	askResponse: string | undefined
	askResponseText: string | undefined
	askResponseImages: string[] | undefined
	askResponseFiles: string[] | undefined
	lastMessageTs: number | undefined
}) {
	const clineMessages: ClineMessage[] = []

	const fakeTask = {
		taskState,
		messageStateHandler: {
			addToClineMessages: async (message: ClineMessage) => {
				clineMessages.push(message)
			},
			getClineMessages: () => clineMessages,
		},
		postStateToWebview: async () => undefined,
		runNotificationHook: async () => undefined,
	}

	return { clineMessages, fakeTask }
}

describe("Task.ask", () => {
	it("keeps resume asks waiting for a user response even when the task is aborted", async () => {
		const clock = sinon.useFakeTimers()
		const taskState: {
			abort: boolean
			askResponse: string | undefined
			askResponseText: string | undefined
			askResponseImages: string[] | undefined
			askResponseFiles: string[] | undefined
			lastMessageTs: number | undefined
		} = {
			abort: true,
			askResponse: undefined,
			askResponseText: undefined,
			askResponseImages: undefined,
			askResponseFiles: undefined,
			lastMessageTs: undefined,
		}
		const { clineMessages, fakeTask } = createFakeTask(taskState)

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (type: "resume_task") => Promise<{ response: string; text?: string }>
				}
			).ask.call(fakeTask, "resume_task")

			let settled = false
			void askPromise.then(
				() => {
					settled = true
				},
				() => {
					settled = true
				},
			)

			await flushMicrotasks()
			assert.equal(clineMessages.length, 1)
			assert.equal(clineMessages[0].ask, "resume_task")
			assert.notEqual(taskState.lastMessageTs, undefined)

			await clock.tickAsync(1_000)
			assert.equal(settled, false)
			assert.equal(taskState.askResponse, undefined)

			taskState.askResponse = "yesButtonClicked"
			taskState.askResponseText = "resume"

			await clock.tickAsync(100)
			const result = await askPromise

			assert.equal(result.response, "yesButtonClicked")
			assert.equal(result.text, "resume")
		} finally {
			clock.restore()
		}
	})

	it("keeps resume-completed asks waiting for a user response even when the task is aborted", async () => {
		const clock = sinon.useFakeTimers()
		const taskState: {
			abort: boolean
			askResponse: string | undefined
			askResponseText: string | undefined
			askResponseImages: string[] | undefined
			askResponseFiles: string[] | undefined
			lastMessageTs: number | undefined
		} = {
			abort: true,
			askResponse: undefined,
			askResponseText: undefined,
			askResponseImages: undefined,
			askResponseFiles: undefined,
			lastMessageTs: undefined,
		}
		const { clineMessages, fakeTask } = createFakeTask(taskState)

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (type: "resume_completed_task") => Promise<{ response: string; text?: string }>
				}
			).ask.call(fakeTask, "resume_completed_task")

			let settled = false
			void askPromise.then(
				() => {
					settled = true
				},
				() => {
					settled = true
				},
			)

			await flushMicrotasks()
			assert.equal(clineMessages.length, 1)
			assert.equal(clineMessages[0].ask, "resume_completed_task")
			assert.notEqual(taskState.lastMessageTs, undefined)

			await clock.tickAsync(1_000)
			assert.equal(settled, false)
			assert.equal(taskState.askResponse, undefined)

			taskState.askResponse = "yesButtonClicked"
			taskState.askResponseText = "resume completed"

			await clock.tickAsync(100)
			const result = await askPromise

			assert.equal(result.response, "yesButtonClicked")
			assert.equal(result.text, "resume completed")
		} finally {
			clock.restore()
		}
	})

	it("still wakes non-resume asks when abort is triggered after the ask is shown", async () => {
		const clock = sinon.useFakeTimers()
		const taskState: {
			abort: boolean
			askResponse: string | undefined
			askResponseText: string | undefined
			askResponseImages: string[] | undefined
			askResponseFiles: string[] | undefined
			lastMessageTs: number | undefined
		} = {
			abort: false,
			askResponse: undefined,
			askResponseText: undefined,
			askResponseImages: undefined,
			askResponseFiles: undefined,
			lastMessageTs: undefined,
		}
		const { clineMessages, fakeTask } = createFakeTask(taskState)

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (type: "completion_result") => Promise<{ response: string }>
				}
			).ask.call(fakeTask, "completion_result")

			await flushMicrotasks()
			assert.equal(clineMessages.length, 1)
			assert.equal(clineMessages[0].ask, "completion_result")

			const rejectionPromise = assert.rejects(askPromise, /Cline instance aborted/)
			taskState.abort = true

			await clock.tickAsync(100)
			await rejectionPromise
		} finally {
			clock.restore()
		}
	})
})
