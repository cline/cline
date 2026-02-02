/**
 * Cline CLI - TypeScript implementation with React Ink
 */

import { exit } from "node:process"
import type { ApiProvider } from "@shared/api"
import { Command } from "commander"
import { render } from "ink"
import React from "react"
import { ClineEndpoint } from "@/config"
import { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { StandaloneTerminalManager } from "@/integrations/terminal/standalone/StandaloneTerminalManager"
import { BannerService } from "@/services/banner/BannerService"
import { ErrorService } from "@/services/error/ErrorService"
import { initializeDistinctId } from "@/services/logging/distinctId"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { Session } from "@/shared/services/Session"
import { getProviderModelIdKey, ProviderToApiKeyMap } from "@/shared/storage"
import { version as CLI_VERSION } from "../package.json"
import { runAcpMode } from "./acp/index.js"
import { App } from "./components/App"
import { checkRawModeSupport } from "./context/StdinContext"
import { createCliHostBridgeProvider } from "./controllers"
import { CliCommentReviewController } from "./controllers/CliCommentReviewController"
import { CliWebviewProvider } from "./controllers/CliWebviewProvider"
import { restoreConsole } from "./utils/console"
import { printInfo, printWarning } from "./utils/display"
import { parseImagesFromInput, processImagePaths } from "./utils/parser"
import { CLINE_CLI_DIR, getCliBinaryPath } from "./utils/path"
import { readStdinIfPiped } from "./utils/piped"
import { runPlainTextTask } from "./utils/plain-text-task"
import { autoUpdateOnStartup, checkForUpdates } from "./utils/update"
import { initializeCliContext } from "./vscode-context"
import { CLI_LOG_FILE, shutdownEvent, window } from "./vscode-shim"

// Track active context for graceful shutdown
let activeContext: CliContext | null = null
let isShuttingDown = false
// Track if we're in plain text mode (no Ink UI) - set by runTask when piped stdin detected
let isPlainTextMode = false

/**
 * Wait for stdout to fully drain before exiting.
 * Critical for piping - ensures data is flushed to the next command in the pipe.
 */
async function drainStdout(): Promise<void> {
	return new Promise<void>((resolve) => {
		// Check if stdout needs draining
		if (process.stdout.writableNeedDrain) {
			process.stdout.once("drain", resolve)
		} else {
			// Give a small delay to ensure any pending writes complete
			setImmediate(resolve)
		}
	})
}

function setupSignalHandlers() {
	const shutdown = async (signal: string) => {
		if (isShuttingDown) {
			// Force exit on second signal
			process.exit(1)
		}
		isShuttingDown = true

		// Notify components to hide UI before shutdown
		shutdownEvent.fire()

		// Only clear Ink UI lines if we're not in plain text mode
		// In plain text mode, there's no Ink UI to clear and the ANSI codes
		// would corrupt the streaming output
		if (!isPlainTextMode) {
			// Clear several lines to remove the input field and footer from display
			// Move cursor up and clear lines (input box + footer rows)
			const linesToClear = 8 // Input box (3 lines with border) + footer (4-5 lines)
			process.stdout.write(`\x1b[${linesToClear}A\x1b[J`)
		}

		printWarning(`${signal} received, shutting down...`)

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

	// Suppress known abort errors from unhandled rejections
	// These occur when task is cancelled and async operations throw "Cline instance aborted"
	process.on("unhandledRejection", (reason: unknown) => {
		const message = reason instanceof Error ? reason.message : String(reason)
		// Silently ignore abort-related errors - they're expected during task cancellation
		if (message.includes("aborted") || message.includes("abort")) {
			Logger.info("Suppressed unhandled rejection due to abort:", message)
			return
		}
		// For other unhandled rejections, log to file via Logger (if available)
		// This won't show in terminal but will be in log files for debugging
		Logger.error("Unhandled rejection:", reason)
	})
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

	await ClineEndpoint.initialize()
	await initializeDistinctId(extensionContext)

	// Initialize/reset session tracking for this CLI run
	Session.reset()

	if (options.enableAuth) {
		AuthHandler.getInstance().setEnabled(true)
	}

	const outputChannel = window.createOutputChannel("Cline CLI")
	outputChannel.appendLine(
		`Cline CLI initialized. Data dir: ${DATA_DIR}, Extension dir: ${EXTENSION_DIR}, Log dir: ${CLINE_CLI_DIR.log}`,
	)
	const logToChannel = (message: string) => outputChannel.appendLine(message)

	HostProvider.initialize(
		() => new CliWebviewProvider(extensionContext as any),
		() => new FileEditProvider(),
		() => new CliCommentReviewController(),
		() => new StandaloneTerminalManager(),
		createCliHostBridgeProvider(workspacePath),
		logToChannel,
		async () => (options.enableAuth ? AuthHandler.getInstance().getCallbackUrl() : ""),
		getCliBinaryPath,
		EXTENSION_DIR,
		DATA_DIR,
	)

	await StateManager.initialize(extensionContext as any)
	await ErrorService.initialize()

	// Initialize OpenAI Codex OAuth manager with extension context for secrets storage
	openAiCodexOAuthManager.initialize(extensionContext)

	// Configure the shared Logging class to use HostProvider's output channel
	Logger.subscribe((msg: string) => HostProvider.get().logToChannel(msg))

	const webview = HostProvider.get().createWebviewProvider() as CliWebviewProvider
	const controller = webview.controller

	BannerService.initialize(webview.controller)

	telemetryService.captureExtensionActivated()
	telemetryService.captureHostEvent("cline_cli", "initialized")

	const ctx = { extensionContext, dataDir: DATA_DIR, extensionDir: EXTENSION_DIR, workspacePath, controller }
	activeContext = ctx
	return ctx
}

/**
 * Run an Ink app with proper cleanup handling
 */
async function runInkApp(element: React.ReactElement, cleanup: () => Promise<void>): Promise<void> {
	// Clear terminal for clean UI - robot will render at row 1
	process.stdout.write("\x1b[2J\x1b[3J\x1b[H")

	// Note: incrementalRendering is disabled because it causes UI glitches on terminal resize.
	// Ink's incremental rendering tries to erase N lines based on previous output height,
	// but when the terminal shrinks, this leaves artifacts. Gemini CLI only enables
	// incrementalRendering when alternateBuffer is also enabled (which we don't use).
	const { waitUntilExit, unmount } = render(element, { exitOnCtrlC: true })

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
		timeout?: string
		images?: string[]
		json?: boolean
		stdinWasPiped?: boolean
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

	// Task without prompt starts in interactive mode
	telemetryService.captureHostEvent("task_command", prompt ? "task" : "interactive")

	if (options.plan) {
		StateManager.get().setGlobalState("mode", "plan")
		telemetryService.captureHostEvent("mode_flag", "plan")
	} else if (options.act) {
		StateManager.get().setGlobalState("mode", "act")
		telemetryService.captureHostEvent("mode_flag", "act")
	}

	if (options.model) {
		const selectedMode = (StateManager.get().getGlobalSettingsKey("mode") || "act") as "act" | "plan"

		// Get the current provider for the selected mode
		const providerKey = selectedMode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const currentProvider = StateManager.get().getGlobalSettingsKey(providerKey) as ApiProvider

		// Update model ID using provider-specific key (e.g., cline uses actModeOpenRouterModelId)
		const modelKey = getProviderModelIdKey(currentProvider, selectedMode)
		if (modelKey) {
			StateManager.get().setGlobalState(modelKey, options.model)
		}
		telemetryService.captureHostEvent("model_flag", options.model)
	}

	// Set thinking budget based on --thinking flag
	const thinkingBudget = options.thinking ? 1024 : 0
	const currentMode = StateManager.get().getGlobalSettingsKey("mode") || "act"
	const thinkingKey = currentMode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"
	StateManager.get().setGlobalState(thinkingKey, thinkingBudget)
	if (options.thinking) {
		telemetryService.captureHostEvent("thinking_flag", "true")
	}

	// Set yolo mode based on --yolo flag
	if (options.yolo) {
		StateManager.get().setGlobalState("yoloModeToggled", true)
		telemetryService.captureHostEvent("yolo_flag", "true")
	}

	await StateManager.get().flushPendingState()

	// Detect if output is a TTY (interactive terminal) or redirected to a file/pipe
	const isTTY = process.stdout.isTTY === true

	// Use plain text mode when output is redirected, stdin was piped, JSON mode is enabled, or --yolo flag is used
	// Ink requires raw mode on stdin which isn't available when stdin is piped
	// Note: we use the stdinWasPiped flag passed from the caller because process.stdin.isTTY
	// may not be reliable after stdin has been consumed by readStdinIfPiped()
	if (!isTTY || options.stdinWasPiped || options.json || options.yolo) {
		// Set flag so shutdown handler knows not to clear Ink UI lines
		isPlainTextMode = true

		// Check if auth is configured before attempting to run the task
		// In plain text mode we can't show the interactive auth flow
		const hasAuth = await isAuthConfigured()
		if (!hasAuth) {
			printWarning("Not authenticated. Please run 'cline auth' first to configure your API credentials.")
			await ctx.controller.stateManager.flushPendingState()
			await ctx.controller.dispose()
			await ErrorService.get().dispose()
			exit(1)
		}

		const reason = options.yolo
			? "yolo_flag"
			: options.json
				? "json"
				: options.stdinWasPiped
					? "piped_stdin"
					: "redirected_output"
		telemetryService.captureHostEvent("plain_text_mode", reason)
		// Plain text mode: no Ink rendering, just clean text output
		const success = await runPlainTextTask({
			controller: ctx.controller,
			prompt: taskPrompt,
			imageDataUrls: imageDataUrls.length > 0 ? imageDataUrls : undefined,
			verbose: options.verbose,
			jsonOutput: options.json,
			timeoutSeconds: options.timeout ? parseInt(options.timeout, 10) : undefined,
		})

		// Cleanup
		await ctx.controller.stateManager.flushPendingState()
		await ctx.controller.dispose()
		await ErrorService.get().dispose()

		// Ensure stdout is fully drained before exiting - critical for piping
		await drainStdout()
		exit(success ? 0 : 1)
	}

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

	telemetryService.captureHostEvent("history_command", "executed")

	if (sortedHistory.length === 0) {
		printInfo("No task history found.")
		await ctx.controller.stateManager.flushPendingState()
		await ctx.controller.dispose()
		await ErrorService.get().dispose()
		exit(0)
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

	telemetryService.captureHostEvent("config_command", "executed")

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

	telemetryService.captureHostEvent("auth_command", hasQuickSetupFlags ? "quick_setup" : "interactive")

	let authError = false

	await runInkApp(
		React.createElement(App, {
			view: "auth",
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			onComplete: () => {
				telemetryService.captureHostEvent("auth", "completed")
				exit(0)
			},
			onError: () => {
				telemetryService.captureHostEvent("auth", "error")
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
	.option("-y, --yolo", "Enable yes/yolo mode (auto-approve actions)")
	.option("-t, --timeout <seconds>", "Timeout in seconds for yes/yolo mode (default: 600)")
	.option("-m, --model <model>", "Model to use for the task")
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

program
	.command("update")
	.description("Check for updates and install if available")
	.option("-v, --verbose", "Show verbose output")
	.action(() => checkForUpdates(CLI_VERSION))

// Dev command with subcommands
const devCommand = program.command("dev").description("Developer tools and utilities")

devCommand
	.command("log")
	.description("Open the log file")
	.action(async () => {
		const { openExternal } = await import("@/utils/env")
		await openExternal(CLI_LOG_FILE)
	})

/**
 * Check if the user has completed onboarding (has any provider configured).
 *
 * Uses `welcomeViewCompleted` as the single source of truth, matching the VS Code extension's approach.
 * If `welcomeViewCompleted` is undefined (first run), checks if ANY provider has credentials
 * and sets the flag accordingly.
 */
async function isAuthConfigured(): Promise<boolean> {
	const stateManager = StateManager.get()

	// Check welcomeViewCompleted first - this is the single source of truth
	const welcomeViewCompleted = stateManager.getGlobalStateKey("welcomeViewCompleted")
	if (welcomeViewCompleted !== undefined) {
		return welcomeViewCompleted
	}

	// welcomeViewCompleted is undefined - run migration logic to check if ANY provider has credentials
	// This mirrors the extension's migrateWelcomeViewCompleted behavior
	const hasAnyAuth = await checkAnyProviderConfigured()

	// Set welcomeViewCompleted based on what we found
	stateManager.setGlobalState("welcomeViewCompleted", hasAnyAuth)
	await stateManager.flushPendingState()

	return hasAnyAuth
}

/**
 * Check if ANY provider has valid credentials configured.
 * Used for migration when welcomeViewCompleted is undefined.
 */
async function checkAnyProviderConfigured(): Promise<boolean> {
	const stateManager = StateManager.get()
	const config = stateManager.getApiConfiguration() as Record<string, unknown>

	// Check Cline account (stored as "cline:clineAccountId" in secrets, loaded into config)
	if (config["cline:clineAccountId"]) return true

	// Check OpenAI Codex OAuth (stored in SECRETS_KEYS, loaded into config)
	if (config["openai-codex-oauth-credentials"]) return true

	// Check all BYO provider API keys (loaded into config from secrets)
	for (const [provider, keyField] of Object.entries(ProviderToApiKeyMap)) {
		// Skip cline - already checked above with the correct key
		if (provider === "cline") continue

		const fields = Array.isArray(keyField) ? keyField : [keyField]
		for (const field of fields) {
			if (config[field]) return true
		}
	}

	// Check provider-specific settings that indicate configuration
	// (for providers that don't require API keys like Bedrock with IAM, Ollama, LM Studio)
	if (config.awsRegion) return true
	if (config.vertexProjectId) return true
	if (config.ollamaBaseUrl) return true
	if (config.lmStudioBaseUrl) return true

	return false
}

/**
 * Show welcome prompt and wait for user input
 * If auth is not configured, show auth flow first
 */
async function showWelcome(options: { verbose?: boolean; cwd?: string; config?: string; thinking?: boolean }) {
	const ctx = await initializeCli({ ...options, enableAuth: true })

	// Check if auth is configured
	const hasAuth = await isAuthConfigured()

	let hadError = false

	await runInkApp(
		React.createElement(App, {
			// Start with auth view if not configured, otherwise welcome
			view: hasAuth ? "welcome" : "auth",
			verbose: options.verbose,
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			onWelcomeExit: () => {
				exit(0)
			},
			onError: () => {
				hadError = true
			},
		}),
		async () => {
			await ctx.controller.stateManager.flushPendingState()
			await ctx.controller.dispose()
			await ErrorService.get().dispose()
			exit(hadError ? 1 : 0)
		},
	)
}

// Interactive mode (default when no command given)
program
	.argument("[prompt]", "Task prompt (starts task immediately)")
	.option("-a, --act", "Run in act mode")
	.option("-p, --plan", "Run in plan mode")
	.option("-y, --yolo", "Enable yolo mode (auto-approve actions)")
	.option("-t, --timeout <seconds>", "Timeout in seconds for yolo mode (default: 600)")
	.option("-m, --model <model>", "Model to use for the task")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory")
	.option("--config <path>", "Configuration directory")
	.option("--thinking", "Enable extended thinking (1024 token budget)")
	.option("--json", "Output messages as JSON instead of styled text")
	.option("--acp", "Run in ACP (Agent Client Protocol) mode for editor integration")
	.action(async (prompt, options) => {
		// Check for ACP mode first - this takes precedence over everything else
		if (options.acp) {
			await runAcpMode({
				config: options.config,
				cwd: options.cwd,
				verbose: options.verbose,
			})
			return
		}

		// Always check for piped stdin content
		const stdinInput = await readStdinIfPiped()

		// If no prompt argument, check if input is piped via stdin
		let effectivePrompt = prompt
		if (stdinInput) {
			if (effectivePrompt) {
				// Prepend stdin content to the prompt
				effectivePrompt = `${stdinInput}\n\n${effectivePrompt}`
			} else {
				effectivePrompt = stdinInput
			}

			telemetryService.captureHostEvent("piped", "detached")

			// Debug: show that we received piped input
			if (options.verbose) {
				process.stderr.write(`[debug] Received ${stdinInput.length} bytes from stdin\n`)
			}
		}

		if (effectivePrompt) {
			// Pass stdinWasPiped flag so runTask knows to use plain text mode
			await runTask(effectivePrompt, { ...options, stdinWasPiped: !!stdinInput })
		} else {
			// Show welcome prompt if no prompt given
			await showWelcome(options)
		}
	})

// Background auto-update check (non-blocking)
autoUpdateOnStartup(CLI_VERSION)

// Parse and run
program.parse()
