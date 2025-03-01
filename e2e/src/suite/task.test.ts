import * as assert from "assert"

suite("Roo Code Task", () => {
	test("Should handle prompt and response correctly", async function () {
		const timeout = 30000
		const interval = 1000

		if (!globalThis.extension) {
			assert.fail("Extension not found")
		}

		// Ensure the webview is launched.
		let startTime = Date.now()

		while (Date.now() - startTime < timeout) {
			if (globalThis.provider.viewLaunched) {
				break
			}

			await new Promise((resolve) => setTimeout(resolve, interval))
		}

		await globalThis.provider.updateGlobalState("mode", "Code")
		await globalThis.provider.updateGlobalState("alwaysAllowModeSwitch", true)
		await globalThis.provider.updateGlobalState("autoApprovalEnabled", true)

		await globalThis.api.startNewTask("Hello world, what is your name? Respond with 'My name is ...'")

		// Wait for task to appear in history with tokens.
		startTime = Date.now()

		while (Date.now() - startTime < timeout) {
			const messages = globalThis.provider.messages

			if (messages.some(({ type, text }) => type === "say" && text?.includes("My name is Roo"))) {
				break
			}

			await new Promise((resolve) => setTimeout(resolve, interval))
		}

		if (globalThis.provider.messages.length === 0) {
			assert.fail("No messages received")
		}

		assert.ok(
			globalThis.provider.messages.some(({ type, text }) => type === "say" && text?.includes("My name is Roo")),
			"Did not receive expected response containing 'My name is Roo'",
		)
	})
})
