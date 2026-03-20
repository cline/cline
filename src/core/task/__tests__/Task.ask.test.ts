import { strict as assert } from "node:assert"
import { setTimeout as delay } from "node:timers/promises"
import { Task } from "@core/task"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, it } from "mocha"

describe("Task.ask", () => {
	it("keeps resume asks waiting for a user response even when the task is aborted", async () => {
		const clineMessages: ClineMessage[] = []
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

		const askPromise = (
			Task.prototype as unknown as {
				ask: (type: "resume_task") => Promise<{ response: string; text?: string }>
			}
		).ask.call(fakeTask, "resume_task")

		await delay(150)
		assert.equal(taskState.askResponse, undefined)

		taskState.askResponse = "yesButtonClicked"
		taskState.askResponseText = "resume"

		const result = await askPromise

		assert.equal(result.response, "yesButtonClicked")
		assert.equal(result.text, "resume")
		assert.equal(clineMessages.length, 1)
		assert.equal(clineMessages[0].ask, "resume_task")
	})

	it("keeps resume-completed asks waiting for a user response even when the task is aborted", async () => {
		const clineMessages: ClineMessage[] = []
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

		const askPromise = (
			Task.prototype as unknown as {
				ask: (type: "resume_completed_task") => Promise<{ response: string; text?: string }>
			}
		).ask.call(fakeTask, "resume_completed_task")

		await delay(150)
		assert.equal(taskState.askResponse, undefined)

		taskState.askResponse = "yesButtonClicked"
		taskState.askResponseText = "resume completed"

		const result = await askPromise

		assert.equal(result.response, "yesButtonClicked")
		assert.equal(result.text, "resume completed")
		assert.equal(clineMessages.length, 1)
		assert.equal(clineMessages[0].ask, "resume_completed_task")
	})

	it("still wakes non-resume asks when abort is triggered after the ask is shown", async () => {
		const clineMessages: ClineMessage[] = []
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

		const askPromise = (
			Task.prototype as unknown as {
				ask: (type: "completion_result") => Promise<{ response: string }>
			}
		).ask.call(fakeTask, "completion_result")

		await delay(150)
		taskState.abort = true

		await assert.rejects(askPromise, /Cline instance aborted/)
		assert.equal(clineMessages[0].ask, "completion_result")
	})
})
