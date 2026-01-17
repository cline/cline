/**
 * Cline CLI - TypeScript implementation
 *
 * A command-line interface for Cline that reuses the core TypeScript codebase,
 * allowing you to run Cline tasks directly from the terminal.
 */

import type { ClineAsk, ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { Command } from "commander"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal/standalone/StandaloneTerminalManager"
import { BannerService } from "@/services/banner/BannerService"
import { ErrorService } from "@/services/error/ErrorService"
import { initializeDistinctId } from "@/services/logging/distinctId"
import { runAuth } from "./cli-auth"
import { CliCommentReviewController } from "./cli-comment-review"
import { createCliHostBridgeProvider } from "./cli-host-bridge"
import { CliWebviewProvider } from "./cli-webview-provider"
// IMPORTANT: Import console module FIRST - it suppresses console.log before core imports
import { restoreConsole } from "./console"
import { print, printError, printInfo, printSuccess, promptConfirmation, promptUser, Spinner, separator, style } from "./display"
import { jsonParseSafe } from "./utils"
import { initializeCliContext } from "./vscode-context"

// Version from package.json
const VERSION = "0.0.0"

/**
 * Setup the host provider for CLI mode
 */
function setupHostProvider(
	extensionContext: any,
	extensionDir: string,
	dataDir: string,
	workspacePath: string,
	verbose: boolean = false,
) {
	const createWebview = () => new CliWebviewProvider(extensionContext)
	const createDiffView = () => new FileEditProvider()
	const createCommentReview = () => new CliCommentReviewController()
	const createTerminalManager = () => new StandaloneTerminalManager()

	const getCallbackUrl = async (): Promise<string> => {
		// CLI doesn't support OAuth callbacks
		return ""
	}

	const getBinaryLocation = async (name: string): Promise<string> => {
		const path = await import("path")
		return path.join(process.cwd(), name)
	}

	// Only log in verbose mode to avoid cluttering the CLI output
	const logToChannel = verbose
		? (message: string) => printInfo(message)
		: (_message: string) => {
				// Silent in non-verbose mode
			}

	HostProvider.initialize(
		createWebview,
		createDiffView,
		createCommentReview,
		createTerminalManager,
		createCliHostBridgeProvider(workspacePath),
		logToChannel,
		getCallbackUrl,
		getBinaryLocation,
		extensionDir,
		dataDir,
	)
}

/**
 * State subscriber that streams text updates to the terminal
 */
class CliStateSubscriber {
	private lastMessageTexts = new Map<number, string>() // Track message text by index for streaming
	private processedAskMessages = new Set<number>() // Track which ask messages we've already prompted for
	private processedSayMessages = new Set<number>() // Track which say messages we've already displayed
	private verbose: boolean
	private spinner: Spinner | null
	private controller: any // Reference to the task controller

	// private lastStreamedMsgTs = 0

	constructor(verbose: boolean = false, controller?: any) {
		this.verbose = verbose
		this.spinner = null
		this.controller = controller
	}

	onStateUpdate(state: ExtensionState) {
		const messages = state.clineMessages || []

		// Stream partial text updates only
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]
			const currentText = message.text || ""
			const lastText = this.lastMessageTexts.get(i) || ""

			// Handle different message types
			if (message.say === "text" && currentText !== lastText) {
				// Stream text messages incrementally
				const newContent = currentText.slice(lastText.length)
				if (newContent) {
					process.stdout.write(newContent)
				}
				this.lastMessageTexts.set(i, currentText)
			} else if (message.say !== "text" && currentText !== lastText && lastText === "") {
				// New non-text message (hasn't been seen before)
				this.displayNewMessage(message)
				this.lastMessageTexts.set(i, currentText)
			}

			if (
				message.type === "say" &&
				message.say === "tool" &&
				message.partial === false &&
				!this.processedSayMessages.has(message.ts)
			) {
				this.processedSayMessages.add(message.ts)
				this.displayNewMessage(message)
			}

			// Check if this is a completed ask message and prompt for input
			if (message.type === "ask" && message.partial === false && !this.processedAskMessages.has(i)) {
				this.processedAskMessages.add(i)
				// Handle ask message asynchronously without blocking state updates
				this.handleAskMessage(message).catch((error) => {
					if (this.verbose) {
						printError(`Error handling ask message: ${error instanceof Error ? error.message : String(error)}`)
					}
				})
			}
		}
	}

	private async handleAskMessage(message: ClineMessage) {
		if (!this.controller || !this.controller.task) {
			return
		}

		const ask = message.ask as ClineAsk

		try {
			switch (ask) {
				case "followup":
				case "plan_mode_respond":
					{
						if (message.text) {
							const parts = jsonParseSafe(message.text, {
								response: undefined as string | undefined,
								options: undefined as string[] | undefined,
								selected: undefined as string | undefined,
								question: undefined as string | undefined,
							})
							if (parts.response) {
								print(style.assistant(`[${message.ask}] ${parts.response}`))
							}
							// Text input questions
							if (parts.question) {
								print(style.assistant(`[${message.ask}] ${parts.question}`))
								const userText = await promptUser("Reply:")
								if (this.controller?.task) {
									await this.controller.task.handleWebviewAskResponse("messageResponse", userText)
								}
							} else if (parts.options && parts.options.length > 0) {
								// Multiple choice options
								printInfo("Options:")
								parts.options.forEach((opt, idx) => {
									printInfo(`  ${idx + 1}. ${opt}`)
								})
								const choiceStr = await promptUser("Select an option (number):")
								const choiceIdx = parseInt(choiceStr, 10) - 1
								if (choiceIdx >= 0 && choiceIdx < parts.options.length) {
									const selectedOption = parts.options[choiceIdx]
									if (this.controller?.task) {
										await this.controller.task.handleWebviewAskResponse("optionSelected", selectedOption)
									}
								} else {
									printError("Invalid option selected.")
								}
							}
						}
					}
					break

				case "act_mode_respond":
					print(style.success(`[${message.ask}] ${message.text || ""}`))
					break

				case "command":
					const approveCmd = await promptConfirmation("Execute this command?")
					if (this.controller?.task) {
						await this.controller.task.handleWebviewAskResponse(approveCmd ? "yesButtonClicked" : "noButtonClicked")
					}
					break

				case "tool":
					const approveTool = await promptConfirmation("Use this tool?")
					if (this.controller?.task) {
						await this.controller.task.handleWebviewAskResponse(approveTool ? "yesButtonClicked" : "noButtonClicked")
					}
					break

				case "completion_result":
					const confirmComplete = await promptConfirmation("Task complete?")
					if (this.controller?.task) {
						await this.controller.task.handleWebviewAskResponse(
							confirmComplete ? "yesButtonClicked" : "noButtonClicked",
						)
					}
					break

				case "resume_task":
				case "resume_completed_task":
					const confirmResume = await promptConfirmation("Resume task?")
					if (this.controller?.task) {
						await this.controller.task.handleWebviewAskResponse(
							confirmResume ? "yesButtonClicked" : "noButtonClicked",
						)
					}
					break

				case "browser_action_launch":
					const confirmBrowser = await promptConfirmation("Launch browser?")
					if (this.controller?.task) {
						await this.controller.task.handleWebviewAskResponse(
							confirmBrowser ? "yesButtonClicked" : "noButtonClicked",
						)
					}
					break

				case "use_mcp_server":
					const confirmMcp = await promptConfirmation("Use MCP server?")
					if (this.controller?.task) {
						await this.controller.task.handleWebviewAskResponse(confirmMcp ? "yesButtonClicked" : "noButtonClicked")
					}
					break

				// Silent asks that don't require user input
				case "command_output":
				case "api_req_failed":
				case "mistake_limit_reached":
					// These are informational - no response needed
					break

				default:
					if (this.verbose) {
						printInfo(`Ask type "${ask}" requires manual response`)
					}
			}
		} catch (error) {
			// Silently ignore errors when controller is being disposed
			if (this.controller && this.verbose) {
				printError(`Failed to handle user response: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
	}

	private displayNewMessage(message: ClineMessage) {
		// Stop spinner if running
		if (this.spinner) {
			const spinner = this.spinner
			spinner.stop()
			this.spinner = null
		}

		// Format and display based on message type
		if (message.type === "say") {
			switch (message.say) {
				case "text":
					// Text messages are streamed incrementally, so we don't need to display again
					// Just ensure the spinner is stopped above
					break
				case "task":
					print(separator("═"))
					print(style.task(`📋 Task: ${message.text || ""}`))
					print(separator("═"))
					break
				case "reasoning":
					if (this.verbose) {
						print(style.dim(`🧠 ${message.text || ""}`))
					}
					break
				case "error":
					printError(message.text || "An error occurred")
					break
				case "completion_result":
					print(separator())
					printSuccess(`✓ ${message.text || "Task completed"}`)
					print(separator())
					break
				case "command":
					print(style.command(`⚙️  Command: ${message.text || ""}`))
					break
				case "command_output":
					if (message.text) {
						const lines = message.text.split("\n")
						const displayLines = lines.slice(0, 10)
						for (const line of displayLines) {
							print(style.dim(`   ${line}`))
						}
						if (lines.length > 10) {
							print(style.dim(`   ... and ${lines.length - 10} more lines`))
						}
					}
					break
				case "tool":
					print(style.tool(`🔧 ${message.text || ""}`))
					break
				case "api_req_started":
					this.spinner = new Spinner()
					if (message.text) {
						// Parse the JSON API request info and format it nicely
						// try {
						// 	const apiInfo = JSON.parse(message.text)
						// 	const details: string[] = []
						// 	if (apiInfo.tokensIn) details.push(`in: ${apiInfo.tokensIn}`)
						// 	if (apiInfo.tokensOut) details.push(`out: ${apiInfo.tokensOut}`)
						// 	if (apiInfo.cost) details.push(`$${apiInfo.cost.toFixed(4)}`)
						// 	const detailStr = details.length > 0 ? ` [${details.join(", ")}]` : ""
						// 	printInfo(`API request${message.text}`)
						// } catch {
						// 	// Fallback if JSON parsing fails
						// 	this.spinner.start("Thinking...")
						// }
					} else {
						this.spinner.start("Thinking...")
					}
					break
				case "api_req_finished":
					this.spinner = null
					break
				case "info":
					printInfo(message.text || "")
					break
				case "checkpoint_created":
					if (this.verbose) {
						print(style.dim(`💾 Checkpoint created`))
					}
					break
			}
		} else if (message.type === "ask") {
			switch (message.ask) {
				case "followup": {
					// Parse JSON question format
					let question = "Question"
					try {
						const parsed = JSON.parse(message.text || "{}")
						question = parsed.question || question
					} catch {
						// Fallback to raw text if not JSON
						question = message.text || question
					}
					print(style.info(`❓ ${question}`))
					break
				}
				case "command":
					print(style.warning(`⚙️  Execute command: ${message.text || ""}`))
					break
				case "tool":
					print(style.info(`🔧 Use tool: ${message.text || ""}`))
					break
				case "completion_result":
					printSuccess(`✅ ${message.text || "Task completed"}`)
					break
				case "api_req_failed":
					printError(`❌ ${message.text || "API request failed"}`)
					break
			}
		}
	}

	reset() {
		this.lastMessageTexts.clear()
		if (this.spinner) {
			this.spinner.stop()
			this.spinner = null
		}
	}
}

/**
 * Run a task with the given prompt
 */
async function runTask(
	prompt: string,
	options: { mode?: string; model?: string; verbose?: boolean; cwd?: string; config?: string },
) {
	const workspacePath = options.cwd || process.cwd()

	if (options.mode) {
		StateManager.get().setGlobalState("mode", options.mode === "plan" ? "plan" : "act")
	}
	if (options.model) {
		const selectedMode = StateManager.get().getGlobalSettingsKey("mode") || "act"
		StateManager.get().setGlobalState(selectedMode === "act" ? "actModeApiModelId" : "planModeApiModelId", options.model)
	}

	printInfo(`🚀 Starting Cline task...`)
	printInfo(`📁 Working directory: ${workspacePath}`)
	print(separator())

	// Initialize context
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		clineDir: options.config,
		workspaceDir: workspacePath,
	})

	// Initialize ErrorService (required by BannerService)
	await ErrorService.initialize()

	// Setup host provider
	setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR, workspacePath, options.verbose)

	// Initialize state manager
	await StateManager.initialize(extensionContext)

	// Create webview provider (which creates the controller)
	const webview = HostProvider.get().createWebviewProvider() as CliWebviewProvider
	const controller = webview.controller

	// Initialize telemetry distinct ID (needed by various services)
	await initializeDistinctId(extensionContext)

	// Initialize BannerService (required by Controller.getStateToPostToWebview)
	if (!BannerService.isInitialized()) {
		BannerService.initialize(controller)
	}

	// Setup state subscriber
	const subscriber = new CliStateSubscriber(options.verbose, controller)

	// Override postStateToWebview to also update CLI
	const originalPostState = controller.postStateToWebview.bind(controller)
	controller.postStateToWebview = async () => {
		await originalPostState()
		const state = await controller.getStateToPostToWebview()
		subscriber.onStateUpdate(state)
	}

	// Start the task
	try {
		const taskId = await controller.initTask(prompt)
		printInfo(`Task ID: ${taskId}`)

		// Wait for task completion by monitoring state updates
		const result = await new Promise<{ success: boolean }>((resolve) => {
			let completionTimeout: NodeJS.Timeout | null = null
			const checkInterval: NodeJS.Timeout | null = null

			// Wrap the original onStateUpdate to detect completion
			const originalOnStateUpdate = subscriber.onStateUpdate.bind(subscriber)
			subscriber.onStateUpdate = async (state: ExtensionState) => {
				// Call original update
				originalOnStateUpdate(state)

				// Check for completion
				const lastMessage = state.clineMessages[state.clineMessages.length - 1]
				if (lastMessage) {
					if (lastMessage.say === "completion_result" || lastMessage.ask === "completion_result") {
						if (completionTimeout) clearTimeout(completionTimeout)
						if (checkInterval) clearInterval(checkInterval)
						// Add newline after streaming output
						console.log()
						resolve({ success: true })
					} else if (lastMessage.say === "error" || lastMessage.ask === "api_req_failed") {
						if (completionTimeout) clearTimeout(completionTimeout)
						if (checkInterval) clearInterval(checkInterval)
						resolve({ success: false })
					}
				}
			}

			// Also set up a fallback check every 500ms in case state updates are slow
			// checkInterval = setInterval(async () => {
			// 	const state = await controller.getStateToPostToWebview()
			// 	const lastMessage = state.clineMessages[state.clineMessages.length - 1]
			// 	if (lastMessage) {
			// 		if (
			// 			lastMessage.say === "completion_result" ||
			// 			lastMessage.ask === "plan_mode_respond" ||
			// 			lastMessage.ask === "completion_result"
			// 		) {
			// 			if (checkInterval) clearInterval(checkInterval)
			// 			if (completionTimeout) clearTimeout(completionTimeout)
			// 			console.log()
			// 			resolve({ success: true })
			// 		} else if (lastMessage.say === "error" || lastMessage.ask === "api_req_failed") {
			// 			if (checkInterval) clearInterval(checkInterval)
			// 			if (completionTimeout) clearTimeout(completionTimeout)
			// 			resolve({ success: false })
			// 		}
			// 	}
			// }, 500)

			// Safety timeout - resolve after 10 minutes
			completionTimeout = setTimeout(
				() => {
					if (checkInterval) clearInterval(checkInterval)
					resolve({ success: false })
				},
				10 * 60 * 1000,
			)
		})

		if (result.success) {
			printSuccess("Task completed!")
		} else {
			process.exit(1)
		}
	} catch (error) {
		printError(`Task failed: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	} finally {
		// Cleanup
		restoreConsole()
		await controller.dispose()
		await ErrorService.get().dispose()
	}
}

/**
 * List task history
 */
async function listHistory(options: { config?: string; limit?: number }) {
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		clineDir: options.config,
	})

	await ErrorService.initialize()
	setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR, process.cwd())
	await StateManager.initialize(extensionContext)

	const stateManager = StateManager.get()
	const taskHistory = stateManager.getGlobalStateKey("taskHistory") || []

	const limit = options.limit || 10
	const recentTasks = [...taskHistory.slice(0, limit)]?.reverse()

	if (recentTasks.length === 0) {
		printInfo("No task history found.")
		return
	}

	print(style.bold(`\n📜 Task History (${recentTasks.length} most recent):\n`))
	print(separator())

	for (const task of recentTasks) {
		const date = new Date(task.ts).toLocaleString()
		const taskText = task.task?.substring(0, 60) || "Unknown task"
		const truncated = (task.task?.length || 0) > 60 ? "..." : ""

		print(`${style.dim(date)}`)
		print(`  ${style.info(task.id)}`)
		print(`  ${taskText}${truncated}`)
		if (task.totalCost) {
			print(`  ${style.dim(`Cost: $${task.totalCost.toFixed(4)}`)}`)
		}
		print("")
	}

	print(separator())
}

/**
 * Show current configuration
 */
async function showConfig(options: { config?: string }) {
	const { DATA_DIR } = initializeCliContext({
		clineDir: options.config,
	})

	await ErrorService.initialize()
	setupHostProvider(extensionContext, DATA_DIR, DATA_DIR, process.cwd())
	await StateManager.initialize(extensionContext)

	const stateManager = StateManager.get()

	print(style.bold(`\n⚙️  Cline Configuration:\n`))
	print(separator())
	print(`Data directory: ${style.path(DATA_DIR)}`)
	print(separator())

	// Get all global state and workspace state entries
	const globalStateEntries = stateManager.getAllGlobalStateEntries()
	const workspaceStateEntries = stateManager.getAllWorkspaceStateEntries()
	const apiConfig = stateManager.getApiConfiguration()

	const EXCLUDED_KEYS = ["taskHistory"]

	const shouldExcluded = (key: string, value: any): boolean => {
		if (EXCLUDED_KEYS.includes(key)) return true
		if (key.endsWith("Toggles")) return true
		if (key.startsWith("apiConfig_")) return true
		if (apiConfig[key as keyof typeof apiConfig] !== undefined) return true
		if (!value) return true
		if (typeof value === "object" && Object.keys(value).length === 0) return true
		if (Array.isArray(value) && value.length === 0) return true
		if (typeof value === "string" && value.trim() === "") return true
		return false
	}

	if (Object.keys(globalStateEntries).length > 0) {
		print(style.bold(`\nGlobal State:\n`))
		for (const [key, value] of Object.entries(globalStateEntries)) {
			if (shouldExcluded(key, value)) continue
			const displayValue = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)
			print(`${style.info(key)}: ${displayValue}`)
		}
		print("")
	}

	if (Object.keys(workspaceStateEntries).length > 0) {
		print(style.bold(`\nWorkspace State:\n`))
		for (const [key, value] of Object.entries(workspaceStateEntries)) {
			if (shouldExcluded(key, value)) continue
			const displayValue = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)
			print(`${style.info(key)}: ${displayValue}`)
		}
		print("")
	}

	print(separator())
}

// Setup CLI commands
const program = new Command()

program.name("cline").description("Cline CLI - AI coding assistant in your terminal").version(VERSION)

program
	.command("task")
	.alias("t")
	.description("Run a new task")
	.argument("<prompt>", "The task prompt")
	.option("-s, --switch <mode>", "Switch mode: act, plan")
	.option("-m, --model <model>", "Model to use for the task")
	.option("-v, --verbose", "Show verbose output including reasoning")
	.option("-c, --cwd <path>", "Working directory for the task")
	.option("--config <path>", "Path to Cline configuration directory")
	.action(runTask)

program
	.command("history")
	.alias("h")
	.description("List task history")
	.option("-n, --limit <number>", "Number of tasks to show", "10")
	.option("--config <path>", "Path to Cline configuration directory")
	.action(listHistory)

program
	.command("config")
	.description("Show current configuration")
	.option("--config <path>", "Path to Cline configuration directory")
	.action(showConfig)

program
	.command("auth")
	.description("Authenticate a provider and configure what model is used")
	.option("-p, --provider <id>", "Provider ID for quick setup (e.g., openai-native, anthropic)")
	.option("-k, --apikey <key>", "API key for the provider")
	.option("-m, --modelid <id>", "Model ID to configure (e.g., gpt-4o, claude-sonnet-4-5-20250929)")
	.option("-b, --baseurl <url>", "Base URL (optional, only for openai provider)")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory for the task")
	.option("--config <path>", "Path to Cline configuration directory")
	.action(runAuth)

// Interactive mode (default when no command given)
program
	.argument("[prompt]", "Task prompt (starts task immediately)")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory")
	.option("--config <path>", "Configuration directory")
	.action(async (prompt, options) => {
		if (prompt) {
			await runTask(prompt, options)
		} else {
			// Show help if no prompt given
			program.help()
		}
	})

// Parse and run
program.parse()
