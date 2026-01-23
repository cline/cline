/**
 * Cline CLI - TypeScript implementation with React Ink
 */

import path from "node:path"
import { exit } from "node:process"
import type { ApiProvider } from "@shared/api"
import { Command } from "commander"
import { render } from "ink"
import React from "react"
import { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal/standalone/StandaloneTerminalManager"
import { ErrorService } from "@/services/error/ErrorService"
import { initializeDistinctId } from "@/services/logging/distinctId"
import { getProviderModelIdKey } from "@/shared/storage"
import { App } from "./components/App"
import { checkRawModeSupport } from "./context/StdinContext"
import { createCliHostBridgeProvider } from "./controllers"
import { CliCommentReviewController } from "./controllers/CliCommentReviewController"
import { CliWebviewProvider } from "./controllers/CliWebviewProvider"
import { restoreConsole } from "./utils/console"
import { print, printError, printInfo, printWarning, separator } from "./utils/display"
import { parseImagesFromInput, processImagePaths } from "./utils/parser"
import { readStdinIfPiped } from "./utils/piped"
import { initializeCliContext } from "./vscode-context"

export const CLI_VERSION = "0.0.0"

// Track active context for graceful shutdown
let activeContext: CliContext | null = null
let isShuttingDown = false

function setupSignalHandlers() {
	const shutdown = async (signal: string) => {
		if (isShuttingDown) {
			// Force exit on second signal
			process.exit(1)
		}
		isShuttingDown = true
		printWarning(`\n${signal} received, shutting down...`)

		try {
			if (activeContext) {
				const task = activeContext.controller.task
				if (task) {
					task.abortTask()
				}
				await activeContext.controller.stateManager.flushPendingState()
				await activeContext.controller.dispose()
			}
			await ErrorService.get().dispose()
		} catch {
			// Best effort cleanup
		}
		process.exit(0)
	}

	process.on("SIGINT", () => shutdown("SIGINT"))
	process.on("SIGTERM", () => shutdown("SIGTERM"))
}

setupSignalHandlers()

interface CliContext {
	extensionContext: any
	dataDir: string
	extensionDir: string
	workspacePath: string
	controller: Controller
}

interface InitOptions {
	config?: string
	cwd?: string
	verbose?: boolean
	enableAuth?: boolean
}

/**
 * Initialize all CLI infrastructure and return context needed for commands
 */
async function initializeCli(options: InitOptions): Promise<CliContext> {
	const workspacePath = options.cwd || process.cwd()
	const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		clineDir: options.config,
		workspaceDir: workspacePath,
	})

	if (options.enableAuth) {
		AuthHandler.getInstance().setEnabled(true)
	}

	// const logToChannel = options.verbose ? (message: string) => printInfo(message) : () => {}
	const logToChannel = () => {}
	process.stdin.write(`Cline CLI version: ${CLI_VERSION} - is verbose: ${options.verbose}`)

	HostProvider.initialize(
		() => new CliWebviewProvider(extensionContext),
		() => new FileEditProvider(),
		() => new CliCommentReviewController(),
		() => new StandaloneTerminalManager(),
		createCliHostBridgeProvider(workspacePath),
		logToChannel,
		async () => (options.enableAuth ? AuthHandler.getInstance().getCallbackUrl() : ""),
		async (name: string) => path.join(process.cwd(), name),
		EXTENSION_DIR,
		DATA_DIR,
	)

	await ErrorService.initialize()
	await StateManager.initialize(extensionContext)

	const webview = HostProvider.get().createWebviewProvider() as CliWebviewProvider
	const controller = webview.controller

	await initializeDistinctId(extensionContext)

	const ctx = { extensionContext, dataDir: DATA_DIR, extensionDir: EXTENSION_DIR, workspacePath, controller }
	activeContext = ctx
	return ctx
}

/**
 * Run an Ink app with proper cleanup handling
 */
async function runInkApp(element: React.ReactElement, cleanup: () => Promise<void>): Promise<void> {
	const { waitUntilExit, unmount } = render(element)

	try {
		await waitUntilExit()
	} finally {
		try {
			unmount()
		} catch {
			// Already unmounted
		}
		restoreConsole()
		await cleanup()
	}
}

/**
 * Wait for a condition with timeout
 */
function waitForCondition(check: () => boolean, timeoutMs: number, intervalMs: number = 100): Promise<boolean> {
	return new Promise((resolve) => {
		const startTime = Date.now()
		const poll = () => {
			if (check()) {
				resolve(true)
				return
			}
			if (Date.now() - startTime > timeoutMs) {
				resolve(false)
				return
			}
			setTimeout(poll, intervalMs)
		}
		poll()
	})
}

/**
 * Run a task with the given prompt
 */
async function runTask(
	prompt: string,
	options: {
		act?: boolean
		plan?: boolean
		model?: string
		verbose?: boolean
		cwd?: string
		config?: string
		thinking?: boolean
		yolo?: boolean
		images?: string[]
	},
	existingContext?: CliContext,
) {
	const ctx = existingContext || (await initializeCli(options))

	// Parse images from the prompt text (e.g., @/path/to/image.png)
	const { prompt: cleanPrompt, imagePaths: parsedImagePaths } = parseImagesFromInput(prompt)

	// Combine parsed image paths with explicit --images option
	const allImagePaths = [...(options.images || []), ...parsedImagePaths]
	// Convert image file paths to base64 data URLs
	const imageDataUrls = await processImagePaths(allImagePaths)

	// Use clean prompt (with image refs removed)
	const taskPrompt = cleanPrompt || prompt

	if (options.plan) {
		StateManager.get().setGlobalState("mode", "plan")
	} else if (options.act) {
		StateManager.get().setGlobalState("mode", "act")
	}

	if (options.model) {
		const selectedMode = (StateManager.get().getGlobalSettingsKey("mode") || "act") as "act" | "plan"

		// Get the current provider for the selected mode
		const providerKey = selectedMode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const currentProvider = StateManager.get().getGlobalSettingsKey(providerKey) as ApiProvider

		// Update the generic model ID for the current mode
		const modelKey = selectedMode === "act" ? "actModeApiModelId" : "planModeApiModelId"
		StateManager.get().setGlobalState(modelKey, options.model)

		// Also update the provider-specific model ID key if applicable
		const providerModelKey = getProviderModelIdKey(currentProvider, selectedMode)
		if (providerModelKey) {
			StateManager.get().setGlobalState(providerModelKey, options.model)
		}
	}

	// Set thinking budget based on --thinking flag
	const thinkingBudget = options.thinking ? 1024 : 0
	const currentMode = StateManager.get().getGlobalSettingsKey("mode") || "act"
	const thinkingKey = currentMode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"
	StateManager.get().setGlobalState(thinkingKey, thinkingBudget)

	// Set yolo mode based on --yolo flag
	if (options.yolo) {
		StateManager.get().setGlobalState("yoloModeToggled", true)
	}

	await StateManager.get().flushPendingState()

	printInfo(`Starting Cline task...`)
	printInfo(`Working directory: ${ctx.workspacePath}`)
	if (imageDataUrls.length > 0) {
		printInfo(`Images attached: ${imageDataUrls.length}`)
	}
	print(separator())

	let isComplete = false
	let taskError = false

	const { waitUntilExit, unmount } = render(
		React.createElement(App, {
			view: "task",
			taskId: taskPrompt.substring(0, 30),
			verbose: options.verbose,
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			onComplete: () => {
				isComplete = true
			},
			onError: () => {
				taskError = true
				isComplete = true
			},
		}),
	)

	await ctx.controller.initTask(taskPrompt, imageDataUrls.length > 0 ? imageDataUrls : undefined)

	const completed = await waitForCondition(() => isComplete, 10 * 60 * 1000)
	if (!completed) {
		printError("Task timeout")
	}

	// Brief delay for final render
	await new Promise((resolve) => setTimeout(resolve, 100))

	try {
		await waitUntilExit()
		if (taskError) {
			process.exit(1)
		}
	} catch (error) {
		printError(`Task failed: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	} finally {
		try {
			unmount()
		} catch {
			// Already unmounted
		}
		restoreConsole()
		await ctx.controller.stateManager.flushPendingState()
		await ctx.controller.dispose()
		await ErrorService.get().dispose()
		exit(0)
	}
}

/**
 * List task history
 */
async function listHistory(options: { config?: string; limit?: number; page?: number }) {
	const ctx = await initializeCli(options)

	const taskHistory = StateManager.get().getGlobalStateKey("taskHistory") || []
	// Sort by timestamp (newest first) before pagination
	const sortedHistory = [...taskHistory].sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0))
	const limit = typeof options.limit === "string" ? parseInt(options.limit, 10) : options.limit || 10
	const initialPage = typeof options.page === "string" ? parseInt(options.page, 10) : options.page || 1
	const totalCount = sortedHistory.length
	const totalPages = Math.ceil(totalCount / limit)

	if (sortedHistory.length === 0) {
		printInfo("No task history found.")
		await ctx.controller.stateManager.flushPendingState()
		await ctx.controller.dispose()
		await ErrorService.get().dispose()
		exit(0)
		return
	}

	await runInkApp(
		React.createElement(App, {
			view: "history",
			historyItems: [],
			historyAllItems: sortedHistory,
			controller: ctx.controller,
			historyPagination: { page: initialPage, totalPages, totalCount, limit },
			isRawModeSupported: checkRawModeSupport(),
		}),
		async () => {
			await ctx.controller.stateManager.flushPendingState()
			await ctx.controller.dispose()
			await ErrorService.get().dispose()
			exit(0)
		},
	)
}

/**
 * Show current configuration
 */
async function showConfig(options: { config?: string }) {
	const ctx = await initializeCli(options)
	const stateManager = StateManager.get()

	// Dynamically import the wrapper to avoid circular dependencies
	const { ConfigViewWrapper } = await import("./components/ConfigViewWrapper")

	// Check feature flags
	const skillsEnabled = stateManager.getGlobalSettingsKey("skillsEnabled") ?? false

	await runInkApp(
		React.createElement(ConfigViewWrapper, {
			controller: ctx.controller,
			dataDir: ctx.dataDir,
			globalState: stateManager.getAllGlobalStateEntries(),
			workspaceState: stateManager.getAllWorkspaceStateEntries(),
			hooksEnabled: true,
			skillsEnabled,
			isRawModeSupported: checkRawModeSupport(),
		}),
		async () => {
			await ctx.controller.stateManager.flushPendingState()
			await ctx.controller.dispose()
			await ErrorService.get().dispose()
			exit(0)
		},
	)
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
	const ctx = await initializeCli({ ...options, enableAuth: true })

	const hasQuickSetupFlags = options.provider || options.apikey || options.modelid || options.baseurl
	const quickSetup = hasQuickSetupFlags
		? { provider: options.provider, apikey: options.apikey, modelid: options.modelid, baseurl: options.baseurl }
		: undefined

	let authError = false

	await runInkApp(
		React.createElement(App, {
			view: "auth",
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			onComplete: () => {
				exit(0)
			},
			onError: () => {
				authError = true
			},
			authQuickSetup: quickSetup,
		}),
		async () => {
			await ctx.controller.stateManager.flushPendingState()
			await ctx.controller.dispose()
			await ErrorService.get().dispose()
			exit(0)
		},
	)

	if (authError) {
		process.exit(1)
	}
}

// Setup CLI commands
const program = new Command()

program.name("cline").description("Cline CLI - AI coding assistant in your terminal").version(CLI_VERSION)

// Enable positional options to avoid conflicts between root and subcommand options with the same name
program.enablePositionalOptions()

program
	.command("task")
	.alias("t")
	.description("Run a new task")
	.argument("<prompt>", "The task prompt")
	.option("-a, --act", "Run in act mode")
	.option("-p, --plan", "Run in plan mode")
	.option("-y, --yolo", "Enable yolo mode (auto-approve actions)")
	.option("-m, --model <model>", "Model to use for the task")
	.option("-i, --images <paths...>", "Image file paths to include with the task")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory for the task")
	.option("--config <path>", "Path to Cline configuration directory")
	.option("--thinking", "Enable extended thinking (1024 token budget)")
	.action((prompt, options) => runTask(prompt, options))

program
	.command("history")
	.alias("h")
	.description("List task history")
	.option("-n, --limit <number>", "Number of tasks to show", "10")
	.option("-p, --page <number>", "Page number (1-based)", "1")
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

program
	.command("version")
	.description("Show Cline CLI version number")
	.action(() => printInfo(`Cline CLI version: ${CLI_VERSION}`))
/**
 * Show welcome prompt and run task with user input
 */
async function showWelcome(options: { verbose?: boolean; cwd?: string; config?: string; thinking?: boolean }) {
	const ctx = await initializeCli({ ...options, enableAuth: true })

	let submittedPrompt: string | null = null
	let submittedImagePaths: string[] = []

	const { waitUntilExit, unmount } = render(
		React.createElement(App, {
			view: "welcome",
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			onWelcomeSubmit: (prompt: string, imagePaths: string[]) => {
				submittedPrompt = prompt
				submittedImagePaths = imagePaths
				unmount()
			},
			onWelcomeExit: () => {
				unmount()
				exit(0)
			},
		}),
	)

	try {
		await waitUntilExit()
	} catch {
		// App unmounted after prompt submission
	}

	restoreConsole()

	if (submittedPrompt || submittedImagePaths.length > 0) {
		// Run the task with the submitted prompt and images, reusing the existing context
		await runTask(submittedPrompt || "", { ...options, images: submittedImagePaths }, ctx)
	} else {
		// User exited without submitting - clean up and exit
		await ctx.controller.stateManager.flushPendingState()
		await ctx.controller.dispose()
		await ErrorService.get().dispose()
		exit(0)
	}
}

// Interactive mode (default when no command given)
program
	.argument("[prompt]", "Task prompt (starts task immediately)")
	.option("-i, --images <paths...>", "Image file paths to include with the task")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory")
	.option("--config <path>", "Configuration directory")
	.option("--thinking", "Enable extended thinking (1024 token budget)")
	.action(async (prompt, options) => {
		// If no prompt argument, check if input is piped via stdin
		let effectivePrompt = prompt
		if (!effectivePrompt) {
			const stdinInput = await readStdinIfPiped()
			if (stdinInput) {
				effectivePrompt = stdinInput
			}
		}

		if (effectivePrompt) {
			await runTask(effectivePrompt, options)
		} else {
			// Show welcome prompt if no prompt given
			await showWelcome(options)
		}
	})

// Parse and run
program.parse()
