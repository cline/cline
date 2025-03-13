import * as assert from "assert"

import { getCompletion, getMessage, sleep, waitForCompletion, waitUntilAborted } from "./utils"

suite("Roo Code Modes", () => {
	test("Should handle switching modes correctly", async function () {
		const api = globalThis.api

		/**
		 * Switch modes.
		 */

		const switchModesPrompt =
			"For each mode (Code, Architect, Ask) respond with the mode name and what it specializes in after switching to that mode. " +
			"Do not start with the current mode."

		await api.setConfiguration({ mode: "Code", alwaysAllowModeSwitch: true, autoApprovalEnabled: true })
		const switchModesTaskId = await api.startNewTask(switchModesPrompt)
		await waitForCompletion({ api, taskId: switchModesTaskId, timeout: 60_000 })

		/**
		 * Grade the response.
		 */

		const gradePrompt =
			`Given this prompt: ${switchModesPrompt} grade the response from 1 to 10 in the format of "Grade: (1-10)": ` +
			api
				.getMessages(switchModesTaskId)
				.filter(({ type }) => type === "say")
				.map(({ text }) => text ?? "")
				.join("\n")

		await api.setConfiguration({ mode: "Ask" })
		const gradeTaskId = await api.startNewTask(gradePrompt)
		await waitForCompletion({ api, taskId: gradeTaskId, timeout: 60_000 })

		const completion = getCompletion({ api, taskId: gradeTaskId })
		const match = completion?.text?.match(/Grade: (\d+)/)
		const score = parseInt(match?.[1] ?? "0")
		assert.ok(score >= 7 && score <= 10, `Grade must be between 7 and 10 - ${completion?.text}`)

		await api.cancelCurrentTask()
	})
})
