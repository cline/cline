import * as assert from "assert"

import { waitForMessage, getMessage } from "./utils"

suite("Roo Code Modes", () => {
	test("Should handle switching modes correctly", async function () {
		const api = globalThis.api

		let prompt =
			"For each mode (Code, Architect, Ask) respond with the mode name and what it specializes in after switching to that mode, do not start with the current mode, be sure to say 'I AM DONE' after the task is complete."

		await api.setConfiguration({ mode: "Code", alwaysAllowModeSwitch: true, autoApprovalEnabled: true })
		let taskId = await api.startNewTask(prompt)
		await waitForMessage({ api, taskId, include: "I AM DONE", exclude: "be sure to say", timeout: 300_000 })

		// Start grading portion of test to grade the response from 1 to 10.
		prompt = `Given this prompt: ${prompt} grade the response from 1 to 10 in the format of "Grade: (1-10)": ${api
			.getMessages(taskId)
			.filter(({ type }) => type === "say")
			.map(({ text }) => text ?? "")
			.join("\n")}\nBe sure to say 'I AM DONE GRADING' after the task is complete.`

		await api.setConfiguration({ mode: "Ask" })
		taskId = await api.startNewTask(prompt)
		await waitForMessage({ api, taskId, include: "I AM DONE GRADING", exclude: "be sure to say" })

		const match = getMessage({ api, taskId, include: "Grade:", exclude: "Grade: (1-10)" })?.text?.match(
			/Grade: (\d+)/,
		)

		const score = parseInt(match?.[1] ?? "0")
		assert.ok(score >= 7 && score <= 10, "Grade must be between 7 and 10.")
	})
})
