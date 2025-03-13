import * as assert from "assert"

import { sleep, waitFor, getMessage, waitForCompletion } from "./utils"

suite("Roo Code Subtasks", () => {
	test("Should handle subtask cancellation and resumption correctly", async function () {
		const api = globalThis.api

		await api.setConfiguration({
			mode: "Code",
			alwaysAllowModeSwitch: true,
			alwaysAllowSubtasks: true,
			autoApprovalEnabled: true,
			enableCheckpoints: false,
		})

		const childPrompt = "You are a calculator. Respond only with numbers. What is the square root of 9?"

		// Start a parent task that will create a subtask.
		const parentTaskId = await api.startNewTask(
			"You are the parent task. " +
				`Create a subtask by using the new_task tool with the message '${childPrompt}'.` +
				"After creating the subtask, wait for it to complete and then respond 'Parent task resumed'.",
		)

		let spawnedTaskId: string | undefined = undefined

		// Wait for the subtask to be spawned and then cancel it.
		api.on("taskSpawned", (_, childTaskId) => (spawnedTaskId = childTaskId))
		await waitFor(() => !!spawnedTaskId)
		await sleep(2_000) // Give the task a chance to start and populate the history.
		await api.cancelCurrentTask()

		// Wait a bit to ensure any task resumption would have happened.
		await sleep(2_000)

		// The parent task should not have resumed yet, so we shouldn't see
		// "Parent task resumed".
		assert.ok(
			getMessage({
				api,
				taskId: parentTaskId,
				include: "Parent task resumed",
				exclude: "You are the parent task",
			}) === undefined,
			"Parent task should not have resumed after subtask cancellation",
		)

		// Start a new task with the same message as the subtask.
		const anotherTaskId = await api.startNewTask(childPrompt)
		await waitForCompletion({ api, taskId: anotherTaskId })

		// Wait a bit to ensure any task resumption would have happened.
		await sleep(2_000)

		// The parent task should still not have resumed.
		assert.ok(
			getMessage({
				api,
				taskId: parentTaskId,
				include: "Parent task resumed",
				exclude: "You are the parent task",
			}) === undefined,
			"Parent task should not have resumed after subtask cancellation",
		)

		// Clean up - cancel all tasks.
		await api.clearCurrentTask()
		await waitForCompletion({ api, taskId: parentTaskId })
	})
})
