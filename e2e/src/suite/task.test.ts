import * as assert from "assert"
import * as vscode from "vscode"

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

	test("Should handle subtask cancellation and resumption correctly", async function () {
		this.timeout(60000) // Increase timeout for this test
		const interval = 1000

		if (!globalThis.extension) {
			assert.fail("Extension not found")
		}

		// Ensure the webview is launched
		await ensureWebviewLaunched(30000, interval)

		// Set up required global state
		await globalThis.provider.updateGlobalState("mode", "Code")
		await globalThis.provider.updateGlobalState("alwaysAllowModeSwitch", true)
		await globalThis.provider.updateGlobalState("alwaysAllowSubtasks", true)
		await globalThis.provider.updateGlobalState("autoApprovalEnabled", true)

		// 1. Start a parent task that will create a subtask
		await globalThis.api.startNewTask(
			"You are the parent task. Create a subtask by using the new_task tool with the message 'You are the subtask'. " +
				"After creating the subtask, wait for it to complete and then respond with 'Parent task resumed'.",
		)

		// Wait for the parent task to use the new_task tool
		await waitForToolUse("new_task", 30000, interval)

		// Wait for the subtask to be created and start responding
		await waitForMessage("You are the subtask", 10000, interval)

		// 3. Cancel the current task (which should be the subtask)
		await globalThis.provider.cancelTask()

		// 4. Check if the parent task is still waiting (not resumed)
		// We need to wait a bit to ensure any task resumption would have happened
		await new Promise((resolve) => setTimeout(resolve, 5000))

		// The parent task should not have resumed yet, so we shouldn't see "Parent task resumed"
		assert.ok(
			!globalThis.provider.messages.some(
				({ type, text }) => type === "say" && text?.includes("Parent task resumed"),
			),
			"Parent task should not have resumed after subtask cancellation",
		)

		// 5. Start a new task with the same message as the subtask
		await globalThis.api.startNewTask("You are the subtask")

		// Wait for the subtask to complete
		await waitForMessage("Task complete", 20000, interval)

		// 6. Verify that the parent task is still not resumed
		// We need to wait a bit to ensure any task resumption would have happened
		await new Promise((resolve) => setTimeout(resolve, 5000))

		// The parent task should still not have resumed
		assert.ok(
			!globalThis.provider.messages.some(
				({ type, text }) => type === "say" && text?.includes("Parent task resumed"),
			),
			"Parent task should not have resumed after subtask completion",
		)

		// Clean up - cancel all tasks
		await globalThis.provider.cancelTask()
	})
})

// Helper functions
async function ensureWebviewLaunched(timeout: number, interval: number): Promise<void> {
	const startTime = Date.now()
	while (Date.now() - startTime < timeout) {
		if (globalThis.provider.viewLaunched) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, interval))
	}
	throw new Error("Webview failed to launch within timeout")
}

async function waitForToolUse(toolName: string, timeout: number, interval: number): Promise<void> {
	const startTime = Date.now()
	while (Date.now() - startTime < timeout) {
		const messages = globalThis.provider.messages
		if (
			messages.some(
				(message) =>
					message.type === "say" && message.say === "tool" && message.text && message.text.includes(toolName),
			)
		) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, interval))
	}
	throw new Error(`Tool ${toolName} was not used within timeout`)
}

async function waitForMessage(messageContent: string, timeout: number, interval: number): Promise<void> {
	const startTime = Date.now()
	while (Date.now() - startTime < timeout) {
		const messages = globalThis.provider.messages
		if (
			messages.some((message) => message.type === "say" && message.text && message.text.includes(messageContent))
		) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, interval))
	}
	throw new Error(`Message containing "${messageContent}" not found within timeout`)
}
