import * as assert from "assert"

import type { RooCodeAPI, ClineMessage } from "@roo-code/types"

import { sleep, waitFor, waitUntilCompleted } from "./utils"

suite.skip("Roo Code Subtasks", () => {
	test("Should handle subtask cancellation and resumption correctly", async () => {
		// @ts-expect-error - Expose the API to the tests.
		const api = globalThis.api as RooCodeAPI

		const messages: Record<string, ClineMessage[]> = {}

		api.on("message", ({ taskId, message }) => {
			if (message.type === "say" && message.partial === false) {
				messages[taskId] = messages[taskId] || []
				messages[taskId].push(message)
			}
		})

		const childPrompt = "You are a calculator. Respond only with numbers. What is the square root of 9?"

		// Start a parent task that will create a subtask.
		const parentTaskId = await api.startNewTask({
			configuration: {
				mode: "ask",
				alwaysAllowModeSwitch: true,
				alwaysAllowSubtasks: true,
				autoApprovalEnabled: true,
				enableCheckpoints: false,
			},
			text:
				"You are the parent task. " +
				`Create a subtask by using the new_task tool with the message '${childPrompt}'.` +
				"After creating the subtask, wait for it to complete and then respond 'Parent task resumed'.",
		})

		let spawnedTaskId: string | undefined = undefined

		// Wait for the subtask to be spawned and then cancel it.
		api.on("taskSpawned", (_, childTaskId) => (spawnedTaskId = childTaskId))
		await waitFor(() => !!spawnedTaskId)
		await sleep(1_000) // Give the task a chance to start and populate the history.
		await api.cancelCurrentTask()

		// Wait a bit to ensure any task resumption would have happened.
		await sleep(2_000)

		// The parent task should not have resumed yet, so we shouldn't see
		// "Parent task resumed".
		assert.ok(
			messages[parentTaskId].find(({ type, text }) => type === "say" && text === "Parent task resumed") ===
				undefined,
			"Parent task should not have resumed after subtask cancellation",
		)

		// Start a new task with the same message as the subtask.
		const anotherTaskId = await api.startNewTask({ text: childPrompt })
		await waitUntilCompleted({ api, taskId: anotherTaskId })

		// Wait a bit to ensure any task resumption would have happened.
		await sleep(2_000)

		// The parent task should still not have resumed.
		assert.ok(
			messages[parentTaskId].find(({ type, text }) => type === "say" && text === "Parent task resumed") ===
				undefined,
			"Parent task should not have resumed after subtask cancellation",
		)

		// Clean up - cancel all tasks.
		await api.clearCurrentTask()
		await waitUntilCompleted({ api, taskId: parentTaskId })
	})
})
