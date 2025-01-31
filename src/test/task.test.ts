import * as assert from "assert"
import * as vscode from "vscode"

import { ClineAPI } from "../exports/cline"
import { ClineProvider } from "../core/webview/ClineProvider"

suite("Roo Code Task", () => {
	test("Should handle prompt and response correctly", async function () {
		const timeout = 30000
		const interval = 1000

		const extension = vscode.extensions.getExtension("RooVeterinaryInc.roo-cline")

		if (!extension) {
			assert.fail("Extension not found")
		}

		const api: ClineAPI = await extension.activate()

		if (!api) {
			assert.fail("Extension API not found")
		}

		const provider = api.sidebarProvider as ClineProvider

		if (!provider) {
			assert.fail("Provider not found")
		}

		await provider.updateGlobalState("apiProvider", "openrouter")
		await provider.updateGlobalState("openRouterModelId", "anthropic/claude-3.5-sonnet")
		const apiKey = process.env.OPEN_ROUTER_API_KEY

		if (!apiKey) {
			assert.fail("OPEN_ROUTER_API_KEY environment variable is not set")
		}

		await provider.storeSecret("openRouterApiKey", apiKey)

		// Create webview panel with development options.
		const extensionUri = extension.extensionUri

		const panel = vscode.window.createWebviewPanel("roo-cline.SidebarProvider", "Roo Code", vscode.ViewColumn.One, {
			enableScripts: true,
			enableCommandUris: true,
			retainContextWhenHidden: true,
			localResourceRoots: [extensionUri],
		})

		try {
			// Initialize webview with development context.
			panel.webview.options = {
				enableScripts: true,
				enableCommandUris: true,
				localResourceRoots: [extensionUri],
			}

			// Initialize provider with panel.
			provider.resolveWebviewView(panel)

			// Set up message tracking.
			let webviewReady = false
			const originalPostMessage = provider.postMessageToWebview.bind(provider)

			provider.postMessageToWebview = async (message: any) => {
				if (message.type === "state") {
					webviewReady = true
				}

				await originalPostMessage(message)
			}

			// Wait for webview to launch and receive initial state.
			let startTime = Date.now()

			while (Date.now() - startTime < timeout) {
				if (webviewReady) {
					// Wait an additional second for webview to fully initialize.
					await new Promise((resolve) => setTimeout(resolve, 1000))
					break
				}

				await new Promise((resolve) => setTimeout(resolve, interval))
			}

			if (!webviewReady) {
				assert.fail("Webview never became ready")
			}

			// Send webviewDidLaunch to initialize chat.
			await provider.postMessageToWebview({ type: "webviewDidLaunch" })

			// Wait for webview to fully initialize.
			await new Promise((resolve) => setTimeout(resolve, 2000))

			// Restore original postMessage.
			provider.postMessageToWebview = originalPostMessage

			// Wait for OpenRouter models to be fully loaded.
			startTime = Date.now()

			while (Date.now() - startTime < timeout) {
				const models = await provider.readOpenRouterModels()

				if (models && Object.keys(models).length > 0) {
					break
				}

				await new Promise((resolve) => setTimeout(resolve, interval))
			}

			// Send prompt.
			const prompt = "Hello world, what is your name? Respond with 'My name is ...'"

			// Start task.
			try {
				await api.startNewTask(prompt)
			} catch (error) {
				console.error(error)
				assert.fail("Error starting task")
			}

			// Wait for task to appear in history with tokens.
			startTime = Date.now()

			while (Date.now() - startTime < timeout) {
				const state = await provider.getState()
				const task = state.taskHistory?.[0]

				if (task && task.tokensOut > 0) {
					// console.log("Task completed with tokens:", task)
					break
				}

				await new Promise((resolve) => setTimeout(resolve, interval))
			}

			if (provider.messages.length === 0) {
				assert.fail("No messages received")
			}

			// console.log("Provider messages:", JSON.stringify(provider.messages, null, 2))

			assert.ok(
				provider.messages.some(({ type, text }) => type === "say" && text?.includes("My name is Roo")),
				"Did not receive expected response containing 'My name is Roo'",
			)
		} finally {
			panel.dispose()
		}
	})
})
