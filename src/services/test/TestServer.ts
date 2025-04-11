import * as http from "http"
import * as vscode from "vscode"
import { Logger } from "../../services/logging/Logger"
import { WebviewProvider } from "../../core/webview"
import { AutoApprovalSettings } from "../../shared/AutoApprovalSettings"
import { updateGlobalState, getAllExtensionState } from "../../core/storage/state"
import { ClineAsk, ExtensionMessage } from "../../shared/ExtensionMessage"
import { WebviewMessage } from "../../shared/WebviewMessage"

// Task completion tracking
let taskCompletionResolver: (() => void) | null = null

// Function to create a new task completion promise
function createTaskCompletionTracker(): Promise<void> {
	// Create a new promise that will resolve when the task is completed
	return new Promise<void>((resolve) => {
		taskCompletionResolver = resolve
	})
}

// Function to mark the current task as completed
function completeTask(): void {
	if (taskCompletionResolver) {
		taskCompletionResolver()
		taskCompletionResolver = null
		Logger.log("Task marked as completed")
	}
}

let testServer: http.Server | undefined
let messageCatcherDisposable: vscode.Disposable | undefined

/**
 * Updates the auto approval settings to enable all actions
 * @param context The VSCode extension context
 * @param provider The webview provider instance
 */
async function updateAutoApprovalSettings(context: vscode.ExtensionContext, provider?: WebviewProvider) {
	try {
		const { autoApprovalSettings } = await getAllExtensionState(context)

		// Enable all actions
		const updatedSettings: AutoApprovalSettings = {
			...autoApprovalSettings,
			enabled: true,
			actions: {
				readFiles: true,
				readFilesExternally: true,
				editFiles: true,
				editFilesExternally: true,
				executeSafeCommands: true,
				executeAllCommands: true,
				useBrowser: false, // Keep browser disabled for tests
				useMcp: false, // Keep MCP disabled for tests
			},
			maxRequests: 10000, // Increase max requests for tests
		}

		await updateGlobalState(context, "autoApprovalSettings", updatedSettings)
		Logger.log("Auto approval settings updated for test mode")

		// Update the webview with the new state
		if (provider?.controller) {
			await provider.controller.postStateToWebview()
		}
	} catch (error) {
		Logger.log(`Error updating auto approval settings: ${error}`)
	}
}

/**
 * Creates and starts an HTTP server for test automation
 * @param webviewProvider The webview provider instance to use for message catching
 * @returns The created HTTP server instance
 */
export function createTestServer(webviewProvider?: WebviewProvider): http.Server {
	// Update auto approval settings if webviewProvider is available
	if (webviewProvider?.controller?.context) {
		updateAutoApprovalSettings(webviewProvider.controller.context, webviewProvider)
	}
	const PORT = 9876

	testServer = http.createServer((req, res) => {
		// Set CORS headers
		res.setHeader("Access-Control-Allow-Origin", "*")
		res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type")

		// Handle preflight requests
		if (req.method === "OPTIONS") {
			res.writeHead(204)
			res.end()
			return
		}

		// Only handle POST requests to /task
		if (req.method !== "POST" || req.url !== "/task") {
			res.writeHead(404)
			res.end(JSON.stringify({ error: "Not found" }))
			return
		}

		// Parse the request body
		let body = ""
		req.on("data", (chunk) => {
			body += chunk.toString()
		})

		req.on("end", async () => {
			try {
				// Parse the JSON body
				const { task } = JSON.parse(body)

				if (!task) {
					res.writeHead(400)
					res.end(JSON.stringify({ error: "Missing task parameter" }))
					return
				}

				// Get a visible webview instance
				const visibleWebview = WebviewProvider.getVisibleInstance()
				if (!visibleWebview || !visibleWebview.controller) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: "No active Cline instance found" }))
					return
				}

				// Initiate a new task
				Logger.log(`Test server initiating task: ${task}`)

				try {
					// Clear any existing task
					await visibleWebview.controller.clearTask()

					// Ensure we're in Act mode before initiating the task
					const { chatSettings } = await visibleWebview.controller.getStateToPostToWebview()
					if (chatSettings.mode === "plan") {
						// Switch to Act mode if currently in Plan mode
						await visibleWebview.controller.togglePlanActModeWithChatSettings({ mode: "act" })
					}

					// Initiate the new task
					const taskId = await visibleWebview.controller.initTask(task)

					// Create a completion tracker for this task
					const completionPromise = createTaskCompletionTracker()

					// Wait for the task to complete with a timeout
					const timeoutPromise = new Promise<void>((_, reject) => {
						setTimeout(() => reject(new Error("Task completion timeout")), 15 * 60 * 1000) // 15 minute timeout
					})

					try {
						// Wait for either completion or timeout
						await Promise.race([completionPromise, timeoutPromise])

						// Return success response with the task ID
						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(
							JSON.stringify({
								success: true,
								taskId,
								completed: true,
							}),
						)
					} catch (timeoutError) {
						// Task didn't complete within the timeout period
						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(
							JSON.stringify({
								success: true,
								taskId,
								completed: false,
								timeout: true,
							}),
						)
					}
				} catch (error) {
					Logger.log(`Error initiating task: ${error}`)
					res.writeHead(500)
					res.end(JSON.stringify({ error: `Failed to initiate task: ${error}` }))
				}
			} catch (error) {
				res.writeHead(400)
				res.end(JSON.stringify({ error: `Invalid JSON: ${error}` }))
			}
		})
	})

	testServer.listen(PORT, () => {
		Logger.log(`Test server listening on port ${PORT}`)
	})

	// Handle server errors
	testServer.on("error", (error) => {
		Logger.log(`Test server error: ${error}`)
	})

	// Set up message catcher for the provided webview instance or try to get the visible one
	if (webviewProvider) {
		messageCatcherDisposable = createMessageCatcher(webviewProvider)
	} else {
		const visibleWebview = WebviewProvider.getVisibleInstance()
		if (visibleWebview) {
			messageCatcherDisposable = createMessageCatcher(visibleWebview)
		} else {
			Logger.log("No visible webview instance found for message catcher")
		}
	}

	return testServer
}

/**
 * Creates a message catcher that logs all messages sent to the webview
 * and automatically responds to messages that require user intervention
 * @param webviewProvider The webview provider instance
 * @returns A disposable that can be used to clean up the message catcher
 */
export function createMessageCatcher(webviewProvider: WebviewProvider): vscode.Disposable {
	Logger.log("Cline message catcher registered")

	if (webviewProvider && webviewProvider.controller) {
		const originalPostMessageToWebview = webviewProvider.controller.postMessageToWebview

		// Intercept outgoing messages from extension to webview
		webviewProvider.controller.postMessageToWebview = async (message: ExtensionMessage) => {
			Logger.log("Cline message received: " + JSON.stringify(message))

			// Check for completion_result message
			if (message.type === "partialMessage" && message.partialMessage?.say === "completion_result") {
				// Complete the current task
				completeTask()
			}

			// Check for ask messages that require user intervention
			if (message.type === "partialMessage" && message.partialMessage?.type === "ask" && !message.partialMessage.partial) {
				const askType = message.partialMessage.ask as ClineAsk
				const askText = message.partialMessage.text

				// Automatically respond to different types of asks
				setTimeout(() => {
					autoRespondToAsk(webviewProvider, askType, askText)
				}, 100) // Small delay to ensure the message is processed first
			}

			return originalPostMessageToWebview.call(webviewProvider.controller, message)
		}
	} else {
		Logger.log("No visible webview instance found for message catcher")
	}

	return new vscode.Disposable(() => {
		// Cleanup function if needed
		Logger.log("Cline message catcher disposed")
	})
}

/**
 * Automatically responds to ask messages to continue task execution without user intervention
 * @param webviewProvider The webview provider instance
 * @param askType The type of ask message
 * @param askText The text content of the ask message
 */
function autoRespondToAsk(webviewProvider: WebviewProvider, askType: ClineAsk, askText?: string): void {
	if (!webviewProvider.controller) {
		return
	}

	Logger.log(`Auto-responding to ask type: ${askType}`)

	// Create a response message based on the ask type
	const response: WebviewMessage = {
		type: "askResponse",
		askResponse: "yesButtonClicked", // Default to approving most actions
	}

	// Handle specific ask types differently if needed
	switch (askType) {
		case "followup":
			// For follow-up questions, provide a generic response
			response.askResponse = "messageResponse"
			response.text = "I can't answer any questions right now, use your best judgment."
			break

		case "api_req_failed":
			// Always retry API requests
			response.askResponse = "yesButtonClicked" // "Retry" button
			break

		case "completion_result":
			// Accept the completion
			response.askResponse = "messageResponse"
			response.text = "Task completed successfully."
			break

		case "mistake_limit_reached":
			// Provide guidance to continue
			response.askResponse = "messageResponse"
			response.text = "Try breaking down the task into smaller steps."
			break

		case "auto_approval_max_req_reached":
			// Reset the count to continue
			response.askResponse = "yesButtonClicked" // "Reset and continue" button
			break

		case "resume_task":
		case "resume_completed_task":
			// Resume the task
			response.askResponse = "messageResponse"
			break

		case "new_task":
			// Decline creating a new task to keep the current task running
			response.askResponse = "messageResponse"
			response.text = "Continue with the current task."
			break

		case "plan_mode_respond":
			// Respond to plan mode with a message to toggle to Act mode
			response.askResponse = "messageResponse"
			response.text = "PLAN_MODE_TOGGLE_RESPONSE" // Special marker to toggle to Act mode

			// Automatically toggle to Act mode after responding
			setTimeout(async () => {
				try {
					if (webviewProvider.controller) {
						Logger.log("Auto-toggling to Act mode from Plan mode")
						await webviewProvider.controller.togglePlanActModeWithChatSettings({ mode: "act" })
					}
				} catch (error) {
					Logger.log(`Error toggling to Act mode: ${error}`)
				}
			}, 500) // Small delay to ensure the response is processed first
			break

		// For all other ask types (tool, command, browser_action_launch, use_mcp_server),
		// we use the default "yesButtonClicked" to approve the action
	}

	// Send the response message
	webviewProvider.controller.handleWebviewMessage(response)
	Logger.log(`Auto-responded to ${askType} with ${response.askResponse}`)
}

/**
 * Shuts down the test server if it exists
 */
export function shutdownTestServer() {
	if (testServer) {
		testServer.close()
		Logger.log("Test server shut down")
		testServer = undefined
	}

	// Dispose of the message catcher if it exists
	if (messageCatcherDisposable) {
		messageCatcherDisposable.dispose()
		messageCatcherDisposable = undefined
	}
}
