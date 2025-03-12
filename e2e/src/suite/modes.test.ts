import * as assert from "assert"

import { waitForMessage } from "./utils"

suite("Roo Code Modes", () => {
	test("Should handle switching modes correctly", async function () {
		const timeout = 300_000
		const api = globalThis.api

		const testPrompt =
			"For each mode (Code, Architect, Ask) respond with the mode name and what it specializes in after switching to that mode, do not start with the current mode, be sure to say 'I AM DONE' after the task is complete."

		await api.setConfiguration({ mode: "Code", alwaysAllowModeSwitch: true, autoApprovalEnabled: true })
		await api.startNewTask(testPrompt)

		await waitForMessage(api, { include: "I AM DONE", exclude: "be sure to say", timeout })

		if (api.getMessages().length === 0) {
			assert.fail("No messages received")
		}

		// Log the messages to the console.
		api.getMessages().forEach(({ type, text }) => {
			if (type === "say") {
				console.log(text)
			}
		})

		// Start Grading Portion of test to grade the response from 1 to 10.
		await api.setConfiguration({ mode: "Ask" })

		let output = api
			.getMessages()
			.map(({ type, text }) => (type === "say" ? text : ""))
			.join("\n")

		await api.startNewTask(
			`Given this prompt: ${testPrompt} grade the response from 1 to 10 in the format of "Grade: (1-10)": ${output}\nBe sure to say 'I AM DONE GRADING' after the task is complete.`,
		)

		await waitForMessage(api, { include: "I AM DONE GRADING", exclude: "be sure to say", timeout })

		if (api.getMessages().length === 0) {
			assert.fail("No messages received")
		}

		api.getMessages().forEach(({ type, text }) => {
			if (type === "say" && text?.includes("Grade:")) {
				console.log(text)
			}
		})

		const gradeMessage = api
			.getMessages()
			.find(
				({ type, text }) => type === "say" && !text?.includes("Grade: (1-10)") && text?.includes("Grade:"),
			)?.text

		const gradeMatch = gradeMessage?.match(/Grade: (\d+)/)
		const gradeNum = gradeMatch ? parseInt(gradeMatch[1]) : undefined
		assert.ok(gradeNum !== undefined && gradeNum >= 7 && gradeNum <= 10, "Grade must be between 7 and 10")
	})
})
