import * as assert from "assert"
import * as vscode from "vscode"

suite("Roo Code Modes", () => {
	test("Should handle switching modes correctly", async function () {
		const timeout = 30000
		const interval = 1000

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
			await globalThis.api.startNewTask(
				"For each mode (Code, Architect, Ask) respond with the mode name and what it specializes in after switching to that mode, do not start with the current mode, be sure to say 'I AM DONE' after the task is complete",
			)

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

			assert.ok(
				globalThis.provider.messages.some(
					({ type, text }) => type === "say" && text?.includes(`"request":"[switch_mode to 'code' because:`),
				),
				"Did not receive expected response containing 'Roo wants to switch to code mode'",
			)
			assert.ok(
				globalThis.provider.messages.some(
					({ type, text }) => type === "say" && text?.includes("software engineer"),
				),
				"Did not receive expected response containing 'I am Roo in Code mode, specializing in software engineering'",
			)

			assert.ok(
				globalThis.provider.messages.some(
					({ type, text }) =>
						type === "say" && text?.includes(`"request":"[switch_mode to 'architect' because:`),
				),
				"Did not receive expected response containing 'Roo wants to switch to architect mode'",
			)
			assert.ok(
				globalThis.provider.messages.some(
					({ type, text }) =>
						type === "say" && (text?.includes("technical planning") || text?.includes("technical leader")),
				),
				"Did not receive expected response containing 'I am Roo in Architect mode, specializing in analyzing codebases'",
			)

			assert.ok(
				globalThis.provider.messages.some(
					({ type, text }) => type === "say" && text?.includes(`"request":"[switch_mode to 'ask' because:`),
				),
				"Did not receive expected response containing 'Roo wants to switch to ask mode'",
			)
			assert.ok(
				globalThis.provider.messages.some(
					({ type, text }) =>
						type === "say" && (text?.includes("technical knowledge") || text?.includes("technical assist")),
				),
				"Did not receive expected response containing 'I am Roo in Ask mode, specializing in answering questions'",
			)
		} finally {
		}
	})
})
