/**
 * Cline CLI - TypeScript implementation
 *
 * A command-line interface for Cline that reuses the core TypeScript codebase,
 * allowing you to run Cline tasks directly from the terminal.
 */

import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { Command } from "commander"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal/standalone/StandaloneTerminalManager"
import { BannerService } from "@/services/banner/BannerService"
import { initializeDistinctId } from "@/services/logging/distinctId"
import { CliCommentReviewController } from "./cli-comment-review"
import { createCliHostBridgeProvider } from "./cli-host-bridge"
import { CliWebviewProvider } from "./cli-webview-provider"
// IMPORTANT: Import console module FIRST - it suppresses console.log before core imports
import { restoreConsole } from "./console"
import { print, printError, printInfo, printSuccess, Spinner, separator, style } from "./display"
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
		? (message: string) => console.log(`[Cline] ${message}`)
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
 * State subscriber that prints updates to the terminal
 */
class CliStateSubscriber {
	private lastMessageCount = 0
	private verbose: boolean
	private spinner: Spinner | null

	constructor(verbose: boolean = false) {
		this.verbose = verbose
		this.spinner = null
	}

	onStateUpdate(state: ExtensionState) {
		const messages = state.clineMessages || []

		// Only show new messages
		if (messages.length > this.lastMessageCount) {
			const newMessages = messages.slice(this.lastMessageCount)
			for (const message of newMessages) {
				this.displayMessage(message)
			}
			this.lastMessageCount = messages.length
		}
	}

	private displayMessage(message: ClineMessage) {
		// Stop spinner if running
		if (this.spinner) {
			const spinner = this.spinner
			spinner.stop()
			this.spinner = null
		}

		// Format and display based on message type
		if (message.type === "say") {
			switch (message.say) {
				case "task":
					print(separator("═"))
					print(style.task(`📋 Task: ${message.text || ""}`))
					print(separator("═"))
					break
				case "text":
					print(style.assistant(message.text || ""))
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
					this.spinner.start("Thinking...")
					break
				case "api_req_finished":
					this.spinner?.stop()
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
				default:
					if (this.verbose && message.text) {
						print(style.dim(`[${message.say}] ${message.text}`))
					}
			}
		} else if (message.type === "ask") {
			switch (message.ask) {
				case "followup":
					print(style.info(`❓ ${message.text || "Question"}`))
					break
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
				default:
					if (this.verbose && message.text) {
						print(style.dim(`[ASK:${message.ask}] ${message.text}`))
					}
			}
		}
	}

	reset() {
		this.lastMessageCount = 0
		if (this.spinner) {
			this.spinner.stop()
			this.spinner = null
		}
	}
}

/**
 * Run a task with the given prompt
 */
async function runTask(prompt: string, options: { verbose?: boolean; cwd?: string; config?: string }) {
	const workspacePath = options.cwd || process.cwd()

	printInfo(`🚀 Starting Cline task...`)
	printInfo(`📁 Working directory: ${workspacePath}`)
	print(separator())

	// Initialize context
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		clineDir: options.config,
		workspaceDir: workspacePath,
	})

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
	const subscriber = new CliStateSubscriber(options.verbose)

	// Override postStateToWebview to also update CLI
	const originalPostState = controller.postStateToWebview.bind(controller)
	controller.postStateToWebview = async () => {
		await originalPostState()
		const state = await controller.getStateToPostToWebview()
		subscriber.onStateUpdate(state)
	}

	// Start the task
	print(style.task(`📋 Task: ${prompt}`))
	print(separator())

	try {
		const taskId = await controller.initTask(prompt)
		printInfo(`Task ID: ${taskId}`)

		// Wait for task completion
		// In a real implementation, we'd have a proper event system
		// For now, we'll poll the task state
		const result = await new Promise<{ success: boolean }>((resolve) => {
			const checkCompletion = setInterval(async () => {
				const state = await controller.getStateToPostToWebview()

				// Check if task is complete or failed
				const lastMessage = state.clineMessages[state.clineMessages.length - 1]
				if (lastMessage) {
					if (lastMessage.say === "completion_result" || lastMessage.ask === "completion_result") {
						clearInterval(checkCompletion)
						resolve({ success: true })
					} else if (lastMessage.say === "error" || lastMessage.ask === "api_req_failed") {
						clearInterval(checkCompletion)
						resolve({ success: false })
					}
				}
			}, 1000)
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
	}
}

/**
 * List task history
 */
async function listHistory(options: { config?: string; limit?: number }) {
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		clineDir: options.config,
	})

	setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR, process.cwd())
	await StateManager.initialize(extensionContext)

	const stateManager = StateManager.get()
	const taskHistory = stateManager.getGlobalStateKey("taskHistory") || []

	const limit = options.limit || 10
	const recentTasks = taskHistory.slice(0, limit)

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

	print(style.bold(`\n⚙️  Cline Configuration:\n`))
	print(separator())
	print(`Data directory: ${style.path(DATA_DIR)}`)
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
