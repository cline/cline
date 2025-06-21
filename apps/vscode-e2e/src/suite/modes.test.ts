import * as assert from "assert"

import { waitUntilCompleted } from "./utils"
import { setDefaultSuiteTimeout } from "./test-utils"

suite("Roo Code Modes", function () {
	setDefaultSuiteTimeout(this)

	test("Should handle switching modes correctly", async () => {
		const modes: string[] = []

		globalThis.api.on("taskModeSwitched", (_taskId, mode) => modes.push(mode))

		const switchModesTaskId = await globalThis.api.startNewTask({
			configuration: { mode: "code", alwaysAllowModeSwitch: true, autoApprovalEnabled: true },
			text: "For each of `architect`, `ask`, and `debug` use the `switch_mode` tool to switch to that mode.",
		})

		await waitUntilCompleted({ api: globalThis.api, taskId: switchModesTaskId })
		await globalThis.api.cancelCurrentTask()

		assert.ok(modes.includes("architect"))
		assert.ok(modes.includes("ask"))
		assert.ok(modes.includes("debug"))
		assert.ok(modes.length === 3)
	})
})
