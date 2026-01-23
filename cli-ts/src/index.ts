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
import { Logger } from "@/shared/services/Logger"
import { getProviderModelIdKey } from "@/shared/storage"
import { version as CLI_VERSION } from "../package.json"
import { App } from "./components/App"
import { checkRawModeSupport } from "./context/StdinContext"
import { createCliHostBridgeProvider } from "./controllers"
import { CliCommentReviewController } from "./controllers/CliCommentReviewController"
import { CliWebviewProvider } from "./controllers/CliWebviewProvider"
import { restoreConsole } from "./utils/console"
import { calculateRobotTopRow, queryCursorPos } from "./utils/cursor-position"
import { printInfo, printWarning } from "./utils/display"
import { parseImagesFromInput, processImagePaths } from "./utils/parser"
import { readStdinIfPiped } from "./utils/piped"
import { runPlainTextTask } from "./utils/plain-text-task"
import { initializeCliContext } from "./vscode-context"
import { window } from "./vscode-shim"

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

	const outputChannel = window.createOutputChannel("Cline CLI")
	outputChannel.appendLine(`Cline CLI initialized. Data dir: ${DATA_DIR}, Extension dir: ${EXTENSION_DIR}`)
	const logToChannel = (message: string) => outputChannel.appendLine(message)

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

	// Configure the shared Logging class to use HostProvider's output channel
	Logger.setOutput((msg: string) => HostProvider.get().logToChannel(msg))

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
	const { waitUntilExit, unmount } = render(element, { incrementalRendering: true })

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
 * Run a task with the given prompt - uses welcome view for consistent behavior
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
		json?: boolean
	},
	existingContext?: CliContext,
) {
	const ctx = existingContext || (await initializeCli({ ...options, enableAuth: true }))

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

	// Detect if output is a TTY (interactive terminal) or redirected to a file/pipe
	const isTTY = process.stdout.isTTY === true

	// Use plain text mode when output is redirected or JSON mode is enabled
	if (!isTTY || options.json) {
		// Plain text mode: no Ink rendering, just clean text output
		const success = await runPlainTextTask({
			controller: ctx.controller,
			prompt: taskPrompt,
			imageDataUrls: imageDataUrls.length > 0 ? imageDataUrls : undefined,
			verbose: options.verbose,
			jsonOutput: options.json,
		})

		// Cleanup
		await ctx.controller.stateManager.flushPendingState()
		await ctx.controller.dispose()
		await ErrorService.get().dispose()
		exit(success ? 0 : 1)
	}

	// Use welcome view for consistent rendering (same as interactive mode)
	// Query cursor position BEFORE Ink mounts to know where robot will render
	const cursorPos = await queryCursorPos(process.stdin, process.stdout)
	const terminalRows = process.stdout.rows ?? 24
	const robotTopRow = calculateRobotTopRow(cursorPos, terminalRows)

	let taskError = false

	// Render the welcome view with optional initial prompt/images
	// If prompt provided (cline task "prompt"), ChatView will auto-submit
	// If no prompt (cline interactive), user will type it in
	await runInkApp(
		React.createElement(App, {
			view: "welcome",
			verbose: options.verbose,
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			robotTopRow,
			initialPrompt: taskPrompt || undefined,
			initialImages: imageDataUrls.length > 0 ? imageDataUrls : undefined,
			onError: () => {
				taskError = true
			},
			onWelcomeExit: () => {
				// User pressed Esc
				exit(0)
			},
		}),
		async () => {
			await ctx.controller.stateManager.flushPendingState()
			await ctx.controller.dispose()
			await ErrorService.get().dispose()
			if (taskError) {
				printWarning("Task ended with errors.")
				exit(1)
			}
			exit(0)
		},
	)
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
	.option("--json", "Output messages as JSON instead of styled text")
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
 * Show welcome prompt and wait for user input
 * Just calls runTask with empty prompt to show welcome screen
 */
async function showWelcome(options: { verbose?: boolean; cwd?: string; config?: string; thinking?: boolean }) {
	// Empty prompt will show welcome screen and wait for user input
	await runTask("", options)
}

// Interactive mode (default when no command given)
program
	.argument("[prompt]", "Task prompt (starts task immediately)")
	.option("-a, --act", "Run in act mode")
	.option("-p, --plan", "Run in plan mode")
	.option("-y, --yolo", "Enable yolo mode (auto-approve actions)")
	.option("-m, --model <model>", "Model to use for the task")
	.option("-i, --images <paths...>", "Image file paths to include with the task")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory")
	.option("--config <path>", "Configuration directory")
	.option("--thinking", "Enable extended thinking (1024 token budget)")
	.option("--json", "Output messages as JSON instead of styled text")
	.action(async (prompt, options) => {
		// Always check for piped stdin content
		const stdinInput = await readStdinIfPiped()

		// Combine stdin content with prompt argument
		let effectivePrompt = prompt
		if (stdinInput) {
			if (effectivePrompt) {
				// Prepend stdin content to the prompt
				effectivePrompt = `${stdinInput}\n\n${effectivePrompt}`
			} else {
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
