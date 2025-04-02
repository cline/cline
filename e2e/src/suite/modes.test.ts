import * as assert from "assert"

import type { ClineMessage } from "../../../src/exports/roo-code"

import { waitUntilCompleted } from "./utils"

suite("Roo Code Modes", () => {
	test("Should handle switching modes correctly", async () => {
		const api = globalThis.api

		/**
		 * Switch modes.
		 */

		const switchModesPrompt =
			"For each mode (Code, Architect, Ask) respond with the mode name and what it specializes in after switching to that mode. " +
			"Do not start with the current mode."

		let messages: ClineMessage[] = []

		api.on("message", ({ message }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		})

		const switchModesTaskId = await api.startNewTask({
			configuration: { mode: "Code", alwaysAllowModeSwitch: true, autoApprovalEnabled: true },
			text: switchModesPrompt,
		})

		await waitUntilCompleted({ api, taskId: switchModesTaskId, timeout: 60_000 })

		/**
		 * Grade the response.
		 */

		const response = messages
			.filter(({ type, say, partial }) => say === "text")
			.map(({ text }) => text ?? "")
			.join("\n")

		const gradePrompt = `Given this prompt: ${switchModesPrompt} grade the response from 1 to 10 in the format of "Grade: (1-10)". For example: Grade 7\n\nResponse: ${response}`

		messages = []

		const gradeTaskId = await api.startNewTask({ configuration: { mode: "Ask" }, text: gradePrompt })
		await waitUntilCompleted({ api, taskId: gradeTaskId })

		const completion = messages.find(({ type, say, partial }) => say === "completion_result")
		const match = completion?.text?.match(/Grade: (\d+)/)
		const score = parseInt(match?.[1] ?? "0")
		assert.ok(
			score >= 7 && score <= 10,
			`Grade must be between 7 and 10. DEBUG: score = ${score}, completion = ${completion?.text}`,
		)

		await api.cancelCurrentTask()
	})
})
