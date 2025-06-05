import * as http from "http"
import * as vscode from "vscode"
import * as path from "path"
import { execa } from "execa"
import { Logger } from "@services/logging/Logger"
import { WebviewProvider } from "@core/webview"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { TaskServiceClient } from "webview-ui/src/services/grpc-client"
import {
	getWorkspacePath,
	validateWorkspacePath,
	initializeGitRepository,
	getFileChanges,
	calculateToolSuccessRate,
} from "./GitHelper"
import { updateGlobalState, getAllExtensionState, updateApiConfiguration, storeSecret } from "@core/storage/state"
import { ClineAsk, ExtensionMessage } from "@shared/ExtensionMessage"
import { ApiProvider } from "@shared/api"
import { HistoryItem } from "@shared/HistoryItem"
import { getSavedClineMessages, getSavedApiConversationHistory } from "@core/storage/disk"
import { AskResponseRequest } from "@/shared/proto/task"

/**
 * Creates a tracker to monitor tool calls and failures during task execution
 * @param webviewProvider The webview provider instance
 * @returns Object tracking tool calls and failures
 */
function createToolCallTracker(webviewProvider: WebviewProvider): {
	toolCalls: Record<string, number>
	toolFailures: Record<string, number>
} {
	const tracker = {
		toolCalls: {} as Record<string, number>,
		toolFailures: {} as Record<string, number>,
	}

	// Intercept messages to track tool usage
	const originalPostMessageToWebview = webviewProvider.controller.postMessageToWebview
	webviewProvider.controller.postMessageToWebview = async (message: ExtensionMessage) => {
		// NOTE: Tool tracking via partialMessage has been migrated to gRPC streaming
		// This interceptor is kept for potential future use with other message types

		// Track tool calls - commented out as partialMessage is now handled via gRPC
		// if (message.type === "partialMessage" && message.partialMessage?.say === "tool") {
		// 	const toolName = (message.partialMessage.text as any)?.tool
		// 	if (toolName) {
		// 		tracker.toolCalls[toolName] = (tracker.toolCalls[toolName] || 0) + 1
		// 	}
		// }

		// Track tool failures - commented out as partialMessage is now handled via gRPC
		// if (message.type === "partialMessage" && message.partialMessage?.say === "error") {
		// 	const errorText = message.partialMessage.text
		// 	if (errorText && errorText.includes("Error executing tool")) {
		// 		const match = errorText.match(/Error executing tool: (\w+)/)
		// 		if (match && match[1]) {
		// 			const toolName = match[1]
		// 			tracker.toolFailures[toolName] = (tracker.toolFailures[toolName] || 0) + 1
		// 		}
		// 	}
		// }

		return originalPostMessageToWebview.call(webviewProvider.controller, message)
	}

	return tracker
}

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
	// Try to show the Cline sidebar
	Logger.log("[createTestServer] Opening Cline in sidebar...")
	vscode.commands.executeCommand("workbench.view.claude-dev-ActivityBar")

	// Then ensure the webview is focused/loaded
	vscode.commands.executeCommand("claude-dev.SidebarProvider.focus")

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

		// Handle shutdown request
		if (req.method === "POST" && req.url === "/shutdown") {
			res.writeHead(200)
			res.end(JSON.stringify({ success: true, message: "Server shutting down" }))

			// Shut down the server after sending the response
			setTimeout(() => {
				shutdownTestServer()
			}, 100)

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
				const { task, apiKey } = JSON.parse(body)

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
					// Get and validate the workspace path
					const workspacePath = getWorkspacePath(visibleWebview)
					Logger.log(`Using workspace path: ${workspacePath}`)

					// Validate workspace path before proceeding with any operations
					try {
						await validateWorkspacePath(workspacePath)
					} catch (error) {
						Logger.log(`Workspace validation failed: ${error.message}`)
						res.writeHead(500)
						res.end(
							JSON.stringify({
								error: `Workspace validation failed: ${error.message}. Please open a workspace folder in VSCode before running the test.`,
								workspacePath,
							}),
						)
						return
					}

					// Initialize Git repository before starting the task
					try {
						const wasNewlyInitialized = await initializeGitRepository(workspacePath)
						if (wasNewlyInitialized) {
							Logger.log(`Initialized new Git repository in ${workspacePath} before task start`)
						} else {
							Logger.log(`Using existing Git repository in ${workspacePath} before task start`)
						}

						// Log directory contents before task start
						try {
							const { stdout: lsOutput } = await execa("ls", ["-la", workspacePath])
							Logger.log(`Directory contents before task start:\n${lsOutput}`)
						} catch (lsError) {
							Logger.log(`Warning: Failed to list directory contents: ${lsError.message}`)
						}
					} catch (gitError) {
						Logger.log(`Warning: Git initialization failed: ${gitError.message}`)
						Logger.log("Continuing without Git initialization")
					}

					// Clear any existing task
					await visibleWebview.controller.clearTask()

					// If API key is provided, update the API configuration
					if (apiKey) {
						Logger.log("API key provided, updating API configuration")

						// Get current API configuration
						const { apiConfiguration } = await getAllExtensionState(visibleWebview.controller.context)

						// Update API configuration with API key
						const updatedConfig = {
							...apiConfiguration,
							apiProvider: "cline" as ApiProvider,
							clineApiKey: apiKey,
						}

						// Store the API key securely
						await storeSecret(visibleWebview.controller.context, "clineApiKey", apiKey)

						// Update the API configuration
						await updateApiConfiguration(visibleWebview.controller.context, updatedConfig)

						// Update global state to use cline provider
						await updateGlobalState(visibleWebview.controller.context, "apiProvider", "cline" as ApiProvider)

						// Post state to webview to reflect changes
						await visibleWebview.controller.postStateToWebview()
					}

					// Ensure we're in Act mode before initiating the task
					const { chatSettings } = await visibleWebview.controller.getStateToPostToWebview()
					if (chatSettings.mode === "plan") {
						// Switch to Act mode if currently in Plan mode
						await visibleWebview.controller.togglePlanActModeWithChatSettings({ mode: "act" })
					}

					// Initialize tool call tracker
					const toolTracker = createToolCallTracker(visibleWebview)

					// Record task start time
					const taskStartTime = Date.now()

					// Initiate the new task
					const result = await visibleWebview.controller.initTask(task)

					// Try to get the task ID directly from the result or from the state
					let taskId: string | undefined

					if (typeof result === "string") {
						// If initTask returns the task ID directly
						taskId = result
					} else {
						// Wait a moment for the state to update
						await new Promise((resolve) => setTimeout(resolve, 1000))

						// Try to get the task ID from the controller's state
						const state = await visibleWebview.controller.getStateToPostToWebview()
						taskId = state.currentTaskItem?.id

						// If still not found, try polling a few times
						if (!taskId) {
							for (let i = 0; i < 5; i++) {
								await new Promise((resolve) => setTimeout(resolve, 500))
								const updatedState = await visibleWebview.controller.getStateToPostToWebview()
								taskId = updatedState.currentTaskItem?.id
								if (taskId) {
									break
								}
							}
						}
					}

					if (!taskId) {
						throw new Error("Failed to get task ID after initiating task")
					}

					Logger.log(`Task initiated with ID: ${taskId}`)

					// Create a completion tracker for this task
					const completionPromise = createTaskCompletionTracker()

					// Wait for the task to complete with a timeout
					const timeoutPromise = new Promise<void>((_, reject) => {
						setTimeout(() => reject(new Error("Task completion timeout")), 15 * 60 * 1000) // 15 minute timeout
					})

					try {
						// Wait for either completion or timeout
						await Promise.race([completionPromise, timeoutPromise])

						// Get task history and metrics
						const taskHistory = await visibleWebview.controller.getStateToPostToWebview()
						const taskData = taskHistory.taskHistory?.find((t: HistoryItem) => t.id === taskId)

						// Get messages and API conversation history
						let messages: any[] = []
						let apiConversationHistory: any[] = []
						try {
							if (typeof taskId === "string") {
								messages = await getSavedClineMessages(visibleWebview.controller.context, taskId)
							}
						} catch (error) {
							Logger.log(`Error getting saved Cline messages: ${error}`)
						}

						try {
							if (typeof taskId === "string") {
								apiConversationHistory = await getSavedApiConversationHistory(
									visibleWebview.controller.context,
									taskId,
								)
							}
						} catch (error) {
							Logger.log(`Error getting saved API conversation history: ${error}`)
						}

						// Get file changes
						let fileChanges
						try {
							// Get the workspace path using our helper function
							const workspacePath = getWorkspacePath(visibleWebview)
							Logger.log(`Getting file changes from workspace path: ${workspacePath}`)

							// Log directory contents for debugging
							try {
								const { stdout: lsOutput } = await execa("ls", ["-la", workspacePath])
								Logger.log(`Directory contents after task completion:\n${lsOutput}`)
							} catch (lsError) {
								Logger.log(`Warning: Failed to list directory contents: ${lsError.message}`)
							}

							// Get file changes using Git
							fileChanges = await getFileChanges(workspacePath)

							// If no changes were detected, use a fallback method
							if (!fileChanges.created.length && !fileChanges.modified.length && !fileChanges.deleted.length) {
								Logger.log("No changes detected by Git, using fallback directory scan")

								// Try to get a list of all files in the directory
								try {
									const { stdout: findOutput } = await execa("find", [
										workspacePath,
										"-type",
										"f",
										"-not",
										"-path",
										"*/.*",
										"-not",
										"-path",
										"*/node_modules/*",
									])
									const files = findOutput.split("\n").filter(Boolean)

									// Add all files as "created" since we can't determine which ones are new
									fileChanges.created = files.map((file) => path.relative(workspacePath, file))
									Logger.log(`Fallback found ${fileChanges.created.length} files`)
								} catch (findError) {
									Logger.log(`Warning: Fallback directory scan failed: ${findError.message}`)
								}
							}
						} catch (fileChangeError) {
							Logger.log(`Error getting file changes: ${fileChangeError.message}`)
							throw new Error(`Error getting file changes: ${fileChangeError.message}`)
						}

						// Get tool metrics
						const toolMetrics = {
							toolCalls: toolTracker.toolCalls,
							toolFailures: toolTracker.toolFailures,
							totalToolCalls: Object.values(toolTracker.toolCalls).reduce((a, b) => a + b, 0),
							totalToolFailures: Object.values(toolTracker.toolFailures).reduce((a, b) => a + b, 0),
							toolSuccessRate: calculateToolSuccessRate(toolTracker.toolCalls, toolTracker.toolFailures),
						}

						// Calculate task duration
						const taskDuration = Date.now() - taskStartTime

						// Return comprehensive response with all metrics and data
						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(
							JSON.stringify({
								success: true,
								taskId,
								completed: true,
								metrics: {
									tokensIn: taskData?.tokensIn || 0,
									tokensOut: taskData?.tokensOut || 0,
									cost: taskData?.totalCost || 0,
									duration: taskDuration,
									...toolMetrics,
								},
								messages,
								apiConversationHistory,
								files: fileChanges,
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
			// NOTE: Completion and ask message detection has been migrated to gRPC streaming
			// This interceptor is kept for potential future use with other message types

			// Check for completion_result message - commented out as partialMessage is now handled via gRPC
			// if (message.type === "partialMessage" && message.partialMessage?.say === "completion_result") {
			// 	// Complete the current task
			// 	completeTask()
			// }

			// Check for ask messages that require user intervention - commented out as partialMessage is now handled via gRPC
			// if (message.type === "partialMessage" && message.partialMessage?.type === "ask" && !message.partialMessage.partial) {
			// 	const askType = message.partialMessage.ask as ClineAsk
			// 	const askText = message.partialMessage.text

			// 	// Automatically respond to different types of asks
			// 	setTimeout(async () => {
			// 		await autoRespondToAsk(webviewProvider, askType, askText)
			// 	}, 100) // Small delay to ensure the message is processed first
			// }

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
async function autoRespondToAsk(webviewProvider: WebviewProvider, askType: ClineAsk, askText?: string): Promise<void> {
	if (!webviewProvider.controller) {
		return
	}

	Logger.log(`Auto-responding to ask type: ${askType}`)

	// Default to approving most actions
	let responseType = "yesButtonClicked"
	let responseText: string | undefined
	let responseImages: string[] | undefined

	// Handle specific ask types differently if needed
	switch (askType) {
		case "followup":
			// For follow-up questions, provide a generic response
			responseType = "messageResponse"
			responseText = "I can't answer any questions right now, use your best judgment."
			break

		case "api_req_failed":
			// Always retry API requests
			responseType = "yesButtonClicked" // "Retry" button
			break

		case "completion_result":
			// Accept the completion
			responseType = "messageResponse"
			responseText = "Task completed successfully."
			break

		case "mistake_limit_reached":
			// Provide guidance to continue
			responseType = "messageResponse"
			responseText = "Try breaking down the task into smaller steps."
			break

		case "auto_approval_max_req_reached":
			// Reset the count to continue
			responseType = "yesButtonClicked" // "Reset and continue" button
			break

		case "resume_task":
		case "resume_completed_task":
			// Resume the task
			responseType = "messageResponse"
			break

		case "new_task":
			// Decline creating a new task to keep the current task running
			responseType = "messageResponse"
			responseText = "Continue with the current task."
			break

		case "plan_mode_respond":
			// Respond to plan mode with a message to toggle to Act mode
			responseType = "messageResponse"
			responseText = "PLAN_MODE_TOGGLE_RESPONSE" // Special marker to toggle to Act mode

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
	try {
		await TaskServiceClient.askResponse(
			AskResponseRequest.create({
				responseType,
				text: responseText,
				images: responseImages,
			}),
		)
		Logger.log(`Auto-responded to ${askType} with ${responseType}`)
	} catch (error) {
		Logger.log(`Error sending askResponse: ${error}`)
	}
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
