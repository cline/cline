import * as assert from "assert"

import type { RooCodeAPI, ClineMessage } from "@roo-code/types"

import { waitUntilCompleted } from "./utils"

suite("Roo Code Modes", () => {
	test("Should handle switching modes correctly", async () => {
		// @ts-expect-error - Expose the API to the tests.
		const api = globalThis.api as RooCodeAPI

		/**
		 * Switch modes.
		 */

		const switchModesPrompt =
			"For each mode (Architect, Ask, Debug) respond with the mode name and what it specializes in after switching to that mode."

		const messages: ClineMessage[] = []

		const modeSwitches: string[] = []

		api.on("taskModeSwitched", (_taskId, mode) => {
			console.log("taskModeSwitched", mode)
			modeSwitches.push(mode)
		})

		api.on("message", ({ message }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		})

		const switchModesTaskId = await api.startNewTask({
			configuration: { mode: "code", alwaysAllowModeSwitch: true, autoApprovalEnabled: true },
			text: switchModesPrompt,
		})

		await waitUntilCompleted({ api, taskId: switchModesTaskId })
		await api.cancelCurrentTask()

		assert.ok(modeSwitches.includes("architect"))
		assert.ok(modeSwitches.includes("ask"))
		assert.ok(modeSwitches.includes("debug"))
	})
})
