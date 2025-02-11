import * as assert from "assert"
import * as vscode from "vscode"

suite("Roo Code Modes", () => {
	test("Should handle switching modes correctly", async function () {
		const timeout = 30000
		const interval = 1000
		const testPrompt =
			"For each mode (Code, Architect, Ask) respond with the mode name and what it specializes in after switching to that mode, do not start with the current mode, be sure to say 'I AM DONE' after the task is complete"
		if (!globalThis.extension) {
			assert.fail("Extension not found")
		}

		try {
			let startTime = Date.now()

			// Ensure the webview is launched.
			while (Date.now() - startTime < timeout) {
				if (globalThis.provider.viewLaunched) {
					break
				}

				await new Promise((resolve) => setTimeout(resolve, interval))
			}

			await globalThis.provider.updateGlobalState("mode", "Ask")
			await globalThis.provider.updateGlobalState("alwaysAllowModeSwitch", true)
			await globalThis.provider.updateGlobalState("autoApprovalEnabled", true)

			// Start a new task.
			await globalThis.api.startNewTask(testPrompt)

			// Wait for task to appear in history with tokens.
			startTime = Date.now()

			while (Date.now() - startTime < timeout) {
				const messages = globalThis.provider.messages

				if (
					messages.some(
						({ type, text }) =>
							type === "say" && text?.includes("I AM DONE") && !text?.includes("be sure to say"),
					)
				) {
					break
				}

				await new Promise((resolve) => setTimeout(resolve, interval))
			}
			if (globalThis.provider.messages.length === 0) {
				assert.fail("No messages received")
			}

			//Log the messages to the console
			globalThis.provider.messages.forEach(({ type, text }) => {
				if (type === "say") {
					console.log(text)
				}
			})

			//Start Grading Portion of test to grade the response from 1 to 10
			await globalThis.provider.updateGlobalState("mode", "Ask")
			let output = globalThis.provider.messages.map(({ type, text }) => (type === "say" ? text : "")).join("\n")
			await globalThis.api.startNewTask(
				`Given this prompt: ${testPrompt} grade the response from 1 to 10 in the format of "Grade: (1-10)": ${output} \n Be sure to say 'I AM DONE GRADING' after the task is complete`,
			)

			startTime = Date.now()

			while (Date.now() - startTime < timeout) {
				const messages = globalThis.provider.messages

				if (
					messages.some(
						({ type, text }) =>
							type === "say" && text?.includes("I AM DONE GRADING") && !text?.includes("be sure to say"),
					)
				) {
					break
				}

				await new Promise((resolve) => setTimeout(resolve, interval))
			}
			if (globalThis.provider.messages.length === 0) {
				assert.fail("No messages received")
			}
			globalThis.provider.messages.forEach(({ type, text }) => {
				if (type === "say" && text?.includes("Grade:")) {
					console.log(text)
				}
			})
			const grade = globalThis.provider.messages.find(
				({ type, text }) => type === "say" && !text?.includes("Grade: (1-10)") && text?.includes("Grade:"),
			)?.text
			assert.ok(
				grade?.includes("Grade: 10") ||
					grade?.includes("Grade: 9") ||
					grade?.includes("Grade: 8") ||
					grade?.includes("Grade: 7"),
				"Did not receive expected response containing 'Grade: 10' or 'Grade: 9' or 'Grade: 8' or 'Grade: 7'",
			)
		} finally {
		}
	})
})
