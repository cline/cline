import { getSavedApiConversationHistory, getSavedClineMessages } from "@core/storage/disk"
import { WebviewProvider } from "@core/webview"
import { Logger } from "@services/logging/Logger"
import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { ApiProvider } from "@shared/api"
import { HistoryItem } from "@shared/HistoryItem"
import { execa } from "execa"
import * as http from "http"
import * as path from "path"
import * as vscode from "vscode"
import { Controller } from "@/core/controller"
import { ExtensionRegistryInfo } from "@/registry"
import { getCwd } from "@/utils/path"
import { calculateToolSuccessRate, getFileChanges, initializeGitRepository, validateWorkspacePath } from "./GitHelper"

/**
 * Creates a tracker to monitor tool calls and failures during task execution
 * @returns Object tracking tool calls and failures
 */
function createToolCallTracker(): {
	toolCalls: Record<string, number>
	toolFailures: Record<string, number>
} {
	const tracker = {
		toolCalls: {} as Record<string, number>,
		toolFailures: {} as Record<string, number>,
	}
	return tracker
}

// Task completion tracking
let _taskCompletionResolver: (() => void) | null = null

// Function to create a new task completion promise
function createTaskCompletionTracker(): Promise<void> {
	// Create a new promise that will resolve when the task is completed
	return new Promise<void>((resolve) => {
		_taskCompletionResolver = resolve
	})
}

let testServer: http.Server | undefined
let messageCatcherDisposable: vscode.Disposable | undefined

/**
 * Updates the auto approval settings to enable all actions
 * @param context The VSCode extension context
 * @param controller The webview provider instance
 */
async function updateAutoApprovalSettings(controller?: Controller) {
	try {
		const autoApprovalSettings = controller?.stateManager.getGlobalSettingsKey("autoApprovalSettings")

		// Enable all actions
		const updatedSettings: AutoApprovalSettings = {
			...(autoApprovalSettings || DEFAULT_AUTO_APPROVAL_SETTINGS),
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
		}

		controller?.stateManager.setGlobalState("autoApprovalSettings", updatedSettings)
		Logger.log("Auto approval settings updated for test mode")

		// Update the webview with the new state
		if (controller) {
			await controller.postStateToWebview()
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
export async function createTestServer(controller: Controller): Promise<http.Server> {
	// Try to show the Cline sidebar
	Logger.log("[createTestServer] Opening Cline in sidebar...")
	vscode.commands.executeCommand(`workbench.view.${ExtensionRegistryInfo.name}-ActivityBar`)

	// Then ensure the webview is focused/loaded
	vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)

	// Update auto approval settings is available
	await updateAutoApprovalSettings(controller)

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
					const workspacePath = await getCwd()
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
						const apiConfiguration = visibleWebview.controller.stateManager.getApiConfiguration()

						// Update API configuration with API key
						const updatedConfig = {
							...apiConfiguration,
							apiProvider: "cline" as ApiProvider,
							clineAccountId: apiKey,
						}

						// Store the API key securely
						visibleWebview.controller.stateManager.setSecret("clineAccountId", apiKey)

						visibleWebview.controller.stateManager.setApiConfiguration(updatedConfig)

						// Update cache service to use cline provider
						const currentConfig = visibleWebview.controller.stateManager.getApiConfiguration()
						visibleWebview.controller.stateManager.setApiConfiguration({
							...currentConfig,
							planModeApiProvider: "cline",
							actModeApiProvider: "cline",
						})

						// Post state to webview to reflect changes
						await visibleWebview.controller.postStateToWebview()
					}

					// Ensure we're in Act mode before initiating the task
					const { mode } = await visibleWebview.controller.getStateToPostToWebview()
					if (mode === "plan") {
						// Switch to Act mode if currently in Plan mode
						await visibleWebview.controller.togglePlanActMode("act")
					}

					// Initialize tool call tracker
					const toolTracker = createToolCallTracker()

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
								messages = await getSavedClineMessages(taskId)
							}
						} catch (error) {
							Logger.log(`Error getting saved Cline messages: ${error}`)
						}

						try {
							if (typeof taskId === "string") {
								apiConversationHistory = await getSavedApiConversationHistory(taskId)
							}
						} catch (error) {
							Logger.log(`Error getting saved API conversation history: ${error}`)
						}

						// Get file changes
						let fileChanges
						try {
							// Get the workspace path using our helper function
							const workspacePath = await getCwd()
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
					} catch (_timeoutError) {
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

	return testServer
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
