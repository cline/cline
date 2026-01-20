/**
 * Cline CLI - TypeScript implementation with React Ink
 *
 * A command-line interface for Cline that reuses the core TypeScript codebase,
 * allowing you to run Cline tasks directly from the terminal.
 */

import { Command } from "commander"
import { render } from "ink"
import React from "react"
import { StateManager } from "@/core/storage/StateManager"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal/standalone/StandaloneTerminalManager"
import { BannerService } from "@/services/banner/BannerService"
import { ErrorService } from "@/services/error/ErrorService"
import { initializeDistinctId } from "@/services/logging/distinctId"
import { CliCommentReviewController } from "./cli-comment-review"
import { createCliHostBridgeProvider } from "./cli-host-bridge"
import { CliWebviewProvider } from "./cli-webview-provider"
import { App } from "./components/App"
// IMPORTANT: Import console module FIRST - it suppresses console.log before core imports
import { restoreConsole } from "./console"
import { print, printError, printInfo, separator } from "./display"
import { initializeCliContext } from "./vscode-context"

// Version from package.json
const VERSION = "0.0.0"

/**
 * Setup the host provider for CLI mode
 * @param enableAuth - When true, enables AuthHandler for OAuth callbacks (required for Cline sign-in)
 */
function setupHostProvider(
	extensionContext: any,
	extensionDir: string,
	dataDir: string,
	workspacePath: string,
	verbose: boolean = false,
	enableAuth: boolean = false,
) {
	// Enable AuthHandler for auth mode
	if (enableAuth) {
		AuthHandler.getInstance().setEnabled(true)
	}

	const createWebview = () => new CliWebviewProvider(extensionContext)
	const createDiffView = () => new FileEditProvider()
	const createCommentReview = () => new CliCommentReviewController()
	const createTerminalManager = () => new StandaloneTerminalManager()

	const getCallbackUrl = async (): Promise<string> => {
		if (enableAuth) {
			// Use AuthHandler to get localhost callback URL for OAuth
			return await AuthHandler.getInstance().getCallbackUrl()
		}
		// Task mode doesn't need OAuth callbacks
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

	// Track completion
	let isComplete = false
	let taskError = false

	const handleComplete = () => {
		isComplete = true
	}

	const handleError = () => {
		taskError = true
		isComplete = true
	}

	// Render Ink app
	const { waitUntilExit, unmount } = render(
		React.createElement(App, {
			view: "task",
			taskId: prompt.substring(0, 30),
			verbose: options.verbose,
			controller,
			onComplete: handleComplete,
			onError: handleError,
		}),
	)

	// Start the task
	await controller.initTask(prompt)

	// Wait for completion
	try {
		// Poll for completion since we can't easily detect it from the Ink component
		const maxWaitTime = 10 * 60 * 1000 // 10 minutes
		const startTime = Date.now()
		const pollInterval = 100

		await new Promise<void>((resolve) => {
			const checkCompletion = () => {
				if (isComplete) {
					resolve()
					return
				}

				if (Date.now() - startTime > maxWaitTime) {
					printError("Task timeout")
					resolve()
					return
				}

				setTimeout(checkCompletion, pollInterval)
			}

			checkCompletion()
		})

		// Give a moment for final render
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Wait for Ink to finish rendering
		await waitUntilExit()

		if (taskError) {
			process.exit(1)
		}
	} catch (error) {
		printError(`Task failed: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	} finally {
		// Cleanup
		try {
			unmount()
		} catch {
			// Already unmounted
		}
		restoreConsole()
		await controller.dispose()
		await ErrorService.get().dispose()
	}
}

/**
 * List task history
 */
async function listHistory(options: { config?: string; limit?: number }) {
	const workspacePath = process.cwd()
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		clineDir: options.config,
		workspaceDir: workspacePath,
	})

	await ErrorService.initialize()
	setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR, workspacePath)
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

	const stateManager = StateManager.get()
	const taskHistory = stateManager.getGlobalStateKey("taskHistory") || []

	const limit = options.limit || 10
	const recentTasks = [...taskHistory.slice(0, limit)]?.reverse()

	if (recentTasks.length === 0) {
		printInfo("No task history found.")
		return
	}

	const { waitUntilExit, unmount } = render(
		React.createElement(App, {
			view: "history",
			historyItems: recentTasks,
			controller,
		}),
	)

	try {
		await waitUntilExit()
	} finally {
		try {
			unmount()
		} catch {
			// Already unmounted
		}
		restoreConsole()
		await controller.dispose()
		await ErrorService.get().dispose()
	}
}

/**
 * Show current configuration
 */
async function showConfig(options: { config?: string }) {
	const { extensionContext, DATA_DIR } = initializeCliContext({
		clineDir: options.config,
	})

	await ErrorService.initialize()
	setupHostProvider(extensionContext, DATA_DIR, DATA_DIR, process.cwd())
	await StateManager.initialize(extensionContext)

	const stateManager = StateManager.get()

	const globalStateEntries = stateManager.getAllGlobalStateEntries()
	const workspaceStateEntries = stateManager.getAllWorkspaceStateEntries()

	const { waitUntilExit, unmount } = render(
		React.createElement(App, {
			view: "config",
			dataDir: DATA_DIR,
			globalState: globalStateEntries,
			workspaceState: workspaceStateEntries,
		}),
	)

	try {
		await waitUntilExit()
	} finally {
		try {
			unmount()
		} catch {
			// Already unmounted
		}
		restoreConsole()
		await ErrorService.get().dispose()
	}
}

/**
 * Run authentication flow
 */
async function runAuth(options: {
	provider?: string
	apikey?: string
	modelid?: string
	baseurl?: string
	verbose?: boolean
	cwd?: string
	config?: string
}) {
	const workspacePath = options.cwd || process.cwd()
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		clineDir: options.config,
		workspaceDir: workspacePath,
	})

	await ErrorService.initialize()
	// Enable auth mode for OAuth callback support
	setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR, workspacePath, options.verbose, true)
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

	// Determine if quick setup or interactive
	const hasQuickSetupFlags = options.provider || options.apikey || options.modelid || options.baseurl
	const quickSetup = hasQuickSetupFlags
		? {
				provider: options.provider,
				apikey: options.apikey,
				modelid: options.modelid,
				baseurl: options.baseurl,
			}
		: undefined

	let authError = false

	const handleComplete = () => {
		// Auth completed successfully
	}

	const handleError = () => {
		authError = true
	}

	const { waitUntilExit, unmount } = render(
		React.createElement(App, {
			view: "auth",
			controller,
			onComplete: handleComplete,
			onError: handleError,
			authQuickSetup: quickSetup,
		}),
	)

	try {
		await waitUntilExit()

		if (authError) {
			process.exit(1)
		}
	} finally {
		try {
			unmount()
		} catch {
			// Already unmounted
		}
		restoreConsole()
		await controller.dispose()
		await ErrorService.get().dispose()
	}
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
