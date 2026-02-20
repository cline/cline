/**
 * Cline CLI - TypeScript implementation with React Ink
 */

import { exit } from "node:process"
import type { ApiProvider } from "@shared/api"
import { Command } from "commander"
import { render } from "ink"
import React from "react"
import { ClineEndpoint } from "@/config"
import type { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { StandaloneTerminalManager } from "@/integrations/terminal/standalone/StandaloneTerminalManager"
import { ErrorService } from "@/services/error/ErrorService"
import { telemetryService } from "@/services/telemetry"
import { PostHogClientProvider } from "@/services/telemetry/providers/posthog/PostHogClientProvider"
import { HistoryItem } from "@/shared/HistoryItem"
import { Logger } from "@/shared/services/Logger"
import { Session } from "@/shared/services/Session"
import { getProviderModelIdKey, ProviderToApiKeyMap } from "@/shared/storage"
import { isOpenaiReasoningEffort, OPENAI_REASONING_EFFORT_OPTIONS, type OpenaiReasoningEffort } from "@/shared/storage/types"
import { version as CLI_VERSION } from "../package.json"
import { runAcpMode } from "./acp/index.js"
import { App } from "./components/App"
import { checkRawModeSupport } from "./context/StdinContext"
import { createCliHostBridgeProvider } from "./controllers"
import { CliCommentReviewController } from "./controllers/CliCommentReviewController"
import { CliWebviewProvider } from "./controllers/CliWebviewProvider"
import { restoreConsole } from "./utils/console"
import { printInfo, printWarning } from "./utils/display"
import { selectOutputMode } from "./utils/mode-selection"
import { parseImagesFromInput, processImagePaths } from "./utils/parser"
import { CLINE_CLI_DIR, getCliBinaryPath } from "./utils/path"
import { readStdinIfPiped } from "./utils/piped"
import { runPlainTextTask } from "./utils/plain-text-task"
import { applyProviderConfig } from "./utils/provider-config"
import { getValidCliProviders, isValidCliProvider } from "./utils/providers"
import { autoUpdateOnStartup, checkForUpdates } from "./utils/update"
import { initializeCliContext } from "./vscode-context"
import { CLI_LOG_FILE, shutdownEvent, window } from "./vscode-shim"

/**
 * Common options shared between runTask and resumeTask
 */
interface TaskOptions {
	act?: boolean
	plan?: boolean
	model?: string
	verbose?: boolean
	cwd?: string
	config?: string
	thinking?: boolean | string
	reasoningEffort?: string
	maxConsecutiveMistakes?: string
	yolo?: boolean
	doubleCheckCompletion?: boolean
	timeout?: string
	json?: boolean
	stdinWasPiped?: boolean
}

let telemetryDisposed = false

async function disposeTelemetryServices(): Promise<void> {
	if (telemetryDisposed) {
		return
	}

	telemetryDisposed = true
	await Promise.allSettled([telemetryService.dispose(), PostHogClientProvider.getInstance().dispose()])
}

/**
 * Restore yoloModeToggled to its original value from before this CLI session.
 * This ensures the --yolo flag is session-only and doesn't leak into future runs.
 * Must be called before flushPendingState so the restored value gets persisted.
 */
function restoreYoloState(): void {
	if (savedYoloModeToggled !== null) {
		try {
			StateManager.get().setGlobalState("yoloModeToggled", savedYoloModeToggled)
			savedYoloModeToggled = null
		} catch {
			// StateManager may not be initialized (e.g., early exit before init)
		}
	}
}

async function disposeCliContext(ctx: CliContext): Promise<void> {
	restoreYoloState()
	await ctx.controller.stateManager.flushPendingState()
	await ctx.controller.dispose()
	await ErrorService.get().dispose()
	await disposeTelemetryServices()
}

function setModeScopedState(currentMode: "act" | "plan", setter: (mode: "act" | "plan") => void): void {
	const stateManager = StateManager.get()
	setter(currentMode)

	const separateModels = stateManager.getGlobalSettingsKey("planActSeparateModelsSetting") ?? false
	if (!separateModels) {
		const otherMode: "act" | "plan" = currentMode === "act" ? "plan" : "act"
		setter(otherMode)
	}
}

function normalizeReasoningEffort(value?: string): OpenaiReasoningEffort | undefined {
	if (value === undefined) {
		return undefined
	}

	const normalized = value.toLowerCase()
	if (isOpenaiReasoningEffort(normalized)) {
		return normalized
	}

	printWarning(
		`Invalid --reasoning-effort '${value}'. Using 'medium'. Valid values: ${OPENAI_REASONING_EFFORT_OPTIONS.join(", ")}.`,
	)
	return "medium"
}

function normalizeMaxConsecutiveMistakes(value?: string): number | undefined {
	if (value === undefined) {
		return undefined
	}

	const parsed = Number.parseInt(value, 10)
	if (Number.isNaN(parsed) || parsed < 1) {
		printWarning(`Invalid --max-consecutive-mistakes value '${value}'. Expected integer >= 1.`)
		return undefined
	}

	return parsed
}

/**
 * Apply task-related options (mode, model, thinking, yolo) to StateManager.
 * Shared between runTask and resumeTask to avoid duplication.
 */
function applyTaskOptions(options: TaskOptions): void {
	// Apply mode flag
	if (options.plan) {
		StateManager.get().setGlobalState("mode", "plan")
		telemetryService.captureHostEvent("mode_flag", "plan")
	} else if (options.act) {
		StateManager.get().setGlobalState("mode", "act")
		telemetryService.captureHostEvent("mode_flag", "act")
	}

	// Apply model override if specified
	if (options.model) {
		const selectedMode = (StateManager.get().getGlobalSettingsKey("mode") || "act") as "act" | "plan"
		const providerKey = selectedMode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const currentProvider = StateManager.get().getGlobalSettingsKey(providerKey) as ApiProvider
		const modelKey = getProviderModelIdKey(currentProvider, selectedMode)
		if (modelKey) {
			StateManager.get().setGlobalState(modelKey, options.model)
		}
		telemetryService.captureHostEvent("model_flag", options.model)
	}

	// Set thinking budget based on --thinking flag (boolean or number)
	let thinkingBudget = 0
	if (options.thinking) {
		if (typeof options.thinking === "string") {
			const parsed = Number.parseInt(options.thinking, 10)
			if (Number.isNaN(parsed) || parsed < 0) {
				printWarning(`Invalid --thinking value '${options.thinking}'. Using default 1024.`)
				thinkingBudget = 1024
			} else {
				thinkingBudget = parsed
			}
		} else {
			thinkingBudget = 1024
		}
	}
	const currentMode = (StateManager.get().getGlobalSettingsKey("mode") || "act") as "act" | "plan"
	setModeScopedState(currentMode, (mode) => {
		const thinkingKey = mode === "act" ? "actModeThinkingBudgetTokens" : "planModeThinkingBudgetTokens"
		StateManager.get().setGlobalState(thinkingKey, thinkingBudget)
	})
	if (options.thinking) {
		telemetryService.captureHostEvent("thinking_flag", "true")
	}

	const reasoningEffort = normalizeReasoningEffort(options.reasoningEffort)
	if (reasoningEffort !== undefined) {
		setModeScopedState(currentMode, (mode) => {
			const reasoningKey = mode === "act" ? "actModeReasoningEffort" : "planModeReasoningEffort"
			StateManager.get().setGlobalState(reasoningKey, reasoningEffort)
		})
		telemetryService.captureHostEvent("reasoning_effort_flag", reasoningEffort)
	}

	const maxConsecutiveMistakes = normalizeMaxConsecutiveMistakes(options.maxConsecutiveMistakes)
	if (maxConsecutiveMistakes !== undefined) {
		StateManager.get().setGlobalState("maxConsecutiveMistakes", maxConsecutiveMistakes)
		telemetryService.captureHostEvent("max_consecutive_mistakes_flag", String(maxConsecutiveMistakes))
	}

	// Override yolo mode only if --yolo flag is explicitly passed.
	// The original value is saved in initializeCli and restored on exit.
	if (options.yolo) {
		const state = StateManager.get()
		savedYoloModeToggled = state.getGlobalSettingsKey("yoloModeToggled") ?? false
		state.setGlobalState("yoloModeToggled", true)
		telemetryService.captureHostEvent("yolo_flag", "true")
	}

	// Set double-check completion based on flag
	if (options.doubleCheckCompletion) {
		StateManager.get().setGlobalState("doubleCheckCompletionEnabled", true)
		telemetryService.captureHostEvent("double_check_completion_flag", "true")
	}
}

/**
 * Get mode selection result using the extracted, testable selectOutputMode function.
 * This wrapper provides the current process TTY state.
 */
function getModeSelection(options: TaskOptions) {
	return selectOutputMode({
		stdoutIsTTY: process.stdout.isTTY === true,
		stdinIsTTY: process.stdin.isTTY === true,
		stdinWasPiped: options.stdinWasPiped ?? false,
		json: options.json,
		yolo: options.yolo,
	})
}

/**
 * Determine if plain text mode should be used based on options and environment.
 */
function shouldUsePlainTextMode(options: TaskOptions): boolean {
	return getModeSelection(options).usePlainTextMode
}

/**
 * Get the reason for using plain text mode (for telemetry).
 */
function getPlainTextModeReason(options: TaskOptions): string {
	return getModeSelection(options).reason
}

/**
 * Run a task in plain text mode (no Ink UI).
 * Handles auth check, task execution, cleanup, and exit.
 */
async function runTaskInPlainTextMode(
	ctx: CliContext,
	options: TaskOptions,
	taskConfig: {
		prompt?: string
		taskId?: string
		imageDataUrls?: string[]
	},
): Promise<never> {
	// Set flag so shutdown handler knows not to clear Ink UI lines
	isPlainTextMode = true

	// Check if auth is configured before attempting to run the task
	// In plain text mode we can't show the interactive auth flow
	const hasAuth = await isAuthConfigured()
	if (!hasAuth) {
		printWarning("Not authenticated. Please run 'cline auth' first to configure your API credentials.")
		await disposeCliContext(ctx)
		exit(1)
	}

	const reason = getPlainTextModeReason(options)
	telemetryService.captureHostEvent("plain_text_mode", reason)

	// Plain text mode: no Ink rendering, just clean text output
	const success = await runPlainTextTask({
		controller: ctx.controller,
		prompt: taskConfig.prompt,
		taskId: taskConfig.taskId,
		imageDataUrls: taskConfig.imageDataUrls,
		verbose: options.verbose,
		jsonOutput: options.json,
		timeoutSeconds: options.timeout ? Number.parseInt(options.timeout, 10) : undefined,
	})

	// Cleanup
	await disposeCliContext(ctx)

	// Ensure stdout is fully drained before exiting - critical for piping
	await drainStdout()
	exit(success ? 0 : 1)
}

/**
 * Create the standard cleanup function for Ink apps.
 */
function createInkCleanup(ctx: CliContext, onTaskError?: () => boolean): () => Promise<void> {
	return async () => {
		await disposeCliContext(ctx)
		if (onTaskError?.()) {
			printWarning("Task ended with errors.")
			exit(1)
		}
		exit(0)
	}
}

// Track active context for graceful shutdown
let activeContext: CliContext | null = null
let isShuttingDown = false
// Track if we're in plain text mode (no Ink UI) - set by runTask when piped stdin detected
let isPlainTextMode = false
// Track the original yoloModeToggled value from before this CLI session so we can restore it on exit.
// The --yolo flag should only affect the current invocation, not persist across runs.
let savedYoloModeToggled: boolean | null = null

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
			// Restore yolo state before any cleanup - this is idempotent and safe
			// even if disposeCliContext also calls it (restoreYoloState checks savedYoloModeToggled !== null)
			restoreYoloState()

			if (activeContext) {
				const task = activeContext.controller.task
				if (task) {
					task.abortTask()
				}
				await disposeCliContext(activeContext)
			} else {
				// Best-effort flush of restored yolo state when no active context
				try {
					await StateManager.get().flushPendingState()
				} catch {
					// StateManager may not be initialized yet
				}
				await ErrorService.get().dispose()
				await disposeTelemetryServices()
			}
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
	const { extensionContext, storageContext, DATA_DIR, EXTENSION_DIR } = initializeCliContext({
		clineDir: options.config,
		workspaceDir: workspacePath,
	})

	// Set up output channel and Logger early so ClineEndpoint.initialize logs are captured
	const outputChannel = window.createOutputChannel("Cline CLI")
	const logToChannel = (message: string) => outputChannel.appendLine(message)

	// Configure the shared Logging class early to capture all initialization logs
	Logger.subscribe(logToChannel)

	await ClineEndpoint.initialize(EXTENSION_DIR)

	// Auto-update check (after endpoints initialized, so we can detect bundled configs)
	autoUpdateOnStartup(CLI_VERSION)

	// Initialize/reset session tracking for this CLI run
	Session.reset()

	if (options.enableAuth) {
		AuthHandler.getInstance().setEnabled(true)
	}

	outputChannel.appendLine(
		`Cline CLI initialized. Data dir: ${DATA_DIR}, Extension dir: ${EXTENSION_DIR}, Log dir: ${CLINE_CLI_DIR.log}`,
	)

	HostProvider.initialize(
		() => new CliWebviewProvider(extensionContext as any),
		() => new FileEditProvider(),
		() => new CliCommentReviewController(),
		() => new StandaloneTerminalManager(),
		createCliHostBridgeProvider(workspacePath),
		logToChannel,
		async (path: string) => (options.enableAuth ? AuthHandler.getInstance().getCallbackUrl(path) : ""),
		getCliBinaryPath,
		EXTENSION_DIR,
		DATA_DIR,
	)

	await StateManager.initialize(storageContext)
	await ErrorService.initialize()

	const webview = HostProvider.get().createWebviewProvider() as CliWebviewProvider
	const controller = webview.controller

	await telemetryService.captureExtensionActivated()
	await telemetryService.captureHostEvent("cline_cli", "initialized")

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
async function runTask(prompt: string, options: TaskOptions & { images?: string[] }, existingContext?: CliContext) {
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

	// Apply shared task options (mode, model, thinking, yolo)
	applyTaskOptions(options)
	await StateManager.get().flushPendingState()

	// Use plain text mode when output is redirected, stdin was piped, JSON mode is enabled, or --yolo flag is used
	if (shouldUsePlainTextMode(options)) {
		return runTaskInPlainTextMode(ctx, options, {
			prompt: taskPrompt,
			imageDataUrls: imageDataUrls.length > 0 ? imageDataUrls : undefined,
		})
	}

	// Interactive mode: Render the welcome view with optional initial prompt/images
	// If prompt provided (cline task "prompt"), ChatView will auto-submit
	// If no prompt (cline interactive), user will type it in
	let taskError = false

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
				// User pressed Esc; Ink exits and cleanup handles process exit.
			},
		}),
		createInkCleanup(ctx, () => taskError),
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
	const limit = typeof options.limit === "string" ? Number.parseInt(options.limit, 10) : options.limit || 10
	const initialPage = typeof options.page === "string" ? Number.parseInt(options.page, 10) : options.page || 1
	const totalCount = sortedHistory.length
	const totalPages = Math.ceil(totalCount / limit)

	telemetryService.captureHostEvent("history_command", "executed")

	if (sortedHistory.length === 0) {
		printInfo("No task history found.")
		await disposeCliContext(ctx)
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
			await disposeCliContext(ctx)
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

	telemetryService.captureHostEvent("config_command", "executed")

	await runInkApp(
		React.createElement(ConfigViewWrapper, {
			controller: ctx.controller,
			dataDir: ctx.dataDir,
			globalState: stateManager.getAllGlobalStateEntries(),
			workspaceState: stateManager.getAllWorkspaceStateEntries(),
			hooksEnabled: true,
			skillsEnabled: true,
			isRawModeSupported: checkRawModeSupport(),
		}),
		async () => {
			await disposeCliContext(ctx)
			exit(0)
		},
	)
}

/**
 * Run authentication flow
 */
/**
 * Perform quick auth setup without UI - validates and saves configuration directly
 */
async function performQuickAuthSetup(
	ctx: CliContext,
	options: { provider: string; apikey: string; modelid: string; baseurl?: string },
): Promise<{ success: boolean; error?: string }> {
	const { provider, apikey, modelid, baseurl } = options

	const normalizedProvider = provider.toLowerCase().trim()

	if (!isValidCliProvider(normalizedProvider)) {
		const validProviders = getValidCliProviders()
		return { success: false, error: `Invalid provider '${provider}'. Supported providers: ${validProviders.join(", ")}` }
	}

	if (normalizedProvider === "bedrock") {
		return {
			success: false,
			error: "Bedrock provider is not supported for quick setup due to complex authentication requirements. Please use interactive setup.",
		}
	}

	if (baseurl && !["openai", "openai-native"].includes(normalizedProvider)) {
		return { success: false, error: "Base URL is only supported for OpenAI and OpenAI-compatible providers" }
	}

	// Save configuration using shared utility
	await applyProviderConfig({
		providerId: normalizedProvider,
		apiKey: apikey,
		modelId: modelid,
		baseUrl: baseurl,
		controller: ctx.controller,
	})

	// Mark onboarding as complete
	StateManager.get().setGlobalState("welcomeViewCompleted", true)
	await StateManager.get().flushPendingState()

	return { success: true }
}

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

	const hasQuickSetupFlags = options.provider && options.apikey && options.modelid

	telemetryService.captureHostEvent("auth_command", hasQuickSetupFlags ? "quick_setup" : "interactive")

	// Quick setup mode - no UI, just save configuration and exit
	if (hasQuickSetupFlags) {
		const result = await performQuickAuthSetup(ctx, {
			provider: options.provider!,
			apikey: options.apikey!,
			modelid: options.modelid!,
			baseurl: options.baseurl,
		})

		if (!result.success) {
			printWarning(result.error || "Quick setup failed")
			await telemetryService.captureHostEvent("auth", "error")
			await disposeCliContext(ctx)
			exit(1)
		}

		await telemetryService.captureHostEvent("auth", "completed")
		await disposeCliContext(ctx)
		exit(0)
	}

	// Interactive mode - show Ink UI
	let authError = false

	await runInkApp(
		React.createElement(App, {
			view: "auth",
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			onComplete: () => {
				telemetryService.captureHostEvent("auth", "completed")
			},
			onError: () => {
				telemetryService.captureHostEvent("auth", "error")
				authError = true
			},
		}),
		async () => {
			await disposeCliContext(ctx)
			exit(authError ? 1 : 0)
		},
	)
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
	.option("-t, --timeout <seconds>", "Optional timeout in seconds (applies only when provided)")
	.option("-m, --model <model>", "Model to use for the task")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory for the task")
	.option("--config <path>", "Path to Cline configuration directory")
	.option("--thinking [tokens]", "Enable extended thinking (default: 1024 tokens)")
	.option("--reasoning-effort <effort>", "Reasoning effort: none|low|medium|high|xhigh")
	.option("--max-consecutive-mistakes <count>", "Maximum consecutive mistakes before halting in yolo mode")
	.option("--json", "Output messages as JSON instead of styled text")
	.option("--double-check-completion", "Reject first completion attempt to force re-verification")
	.option("-T, --taskId <id>", "Resume an existing task by ID")
	.action((prompt, options) => {
		if (options.taskId) {
			return resumeTask(options.taskId, { ...options, initialPrompt: prompt })
		}
		return runTask(prompt, options)
	})

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
	.option("-p, --provider <id>", "Provider ID for quick setup (e.g., openai-native, anthropic, moonshot)")
	.option("-k, --apikey <key>", "API key for the provider")
	.option("-m, --modelid <id>", "Model ID to configure (e.g., gpt-4o, claude-sonnet-4-6, kimi-k2.5)")
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
	if (config["clineApiKey"] || config["cline:clineAccountId"]) return true

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
 * Validate that a task exists in history
 * @returns The task history item if found, null otherwise
 */
function findTaskInHistory(taskId: string): HistoryItem | null {
	const taskHistory = StateManager.get().getGlobalStateKey("taskHistory") || []
	return taskHistory.find((item) => item.id === taskId) || null
}

/**
 * Resume an existing task by ID
 * Loads the task and optionally prefills the input with a prompt
 */
async function resumeTask(taskId: string, options: TaskOptions & { initialPrompt?: string }) {
	const ctx = await initializeCli({ ...options, enableAuth: true })

	// Validate task exists
	const historyItem = findTaskInHistory(taskId)
	if (!historyItem) {
		printWarning(`Task not found: ${taskId}`)
		printInfo("Use 'cline history' to see available tasks.")
		await disposeCliContext(ctx)
		exit(1)
	}

	telemetryService.captureHostEvent("resume_task_command", options.initialPrompt ? "with_prompt" : "interactive")

	// Apply shared task options (mode, model, thinking, yolo)
	applyTaskOptions(options)
	await StateManager.get().flushPendingState()

	// Use plain text mode for non-interactive scenarios
	if (shouldUsePlainTextMode(options)) {
		return runTaskInPlainTextMode(ctx, options, {
			prompt: options.initialPrompt,
			taskId: taskId,
		})
	}

	// Interactive mode: render the task view with the existing task
	let taskError = false

	await runInkApp(
		React.createElement(App, {
			view: "task",
			taskId: taskId,
			verbose: options.verbose,
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			initialPrompt: options.initialPrompt || undefined,
			onError: () => {
				taskError = true
			},
			onWelcomeExit: () => {
				// User pressed Esc; Ink exits and cleanup handles process exit.
			},
		}),
		createInkCleanup(ctx, () => taskError),
	)
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
				// User pressed Esc; Ink exits and cleanup handles process exit.
			},
			onError: () => {
				hadError = true
			},
		}),
		async () => {
			await disposeCliContext(ctx)
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
	.option("-t, --timeout <seconds>", "Optional timeout in seconds (applies only when provided)")
	.option("-m, --model <model>", "Model to use for the task")
	.option("-v, --verbose", "Show verbose output")
	.option("-c, --cwd <path>", "Working directory")
	.option("--config <path>", "Configuration directory")
	.option("--thinking [tokens]", "Enable extended thinking (default: 1024 tokens)")
	.option("--reasoning-effort <effort>", "Reasoning effort: none|low|medium|high|xhigh")
	.option("--max-consecutive-mistakes <count>", "Maximum consecutive mistakes before halting in yolo mode")
	.option("--json", "Output messages as JSON instead of styled text")
	.option("--double-check-completion", "Reject first completion attempt to force re-verification")
	.option("--acp", "Run in ACP (Agent Client Protocol) mode for editor integration")
	.option("-T, --taskId <id>", "Resume an existing task by ID")
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

		// Track whether stdin was actually piped (even if empty) vs not piped (null)
		// stdinInput === null means stdin wasn't piped (TTY or not FIFO/file)
		// stdinInput === "" means stdin was piped but empty
		// stdinInput has content means stdin was piped with data
		const stdinWasPiped = stdinInput !== null

		// Error if stdin was piped but empty AND no prompt was provided
		// This handles:
		// - `echo "" | cline` -> error (empty stdin, no prompt)
		// - `cline "prompt"` in GitHub Actions -> OK (empty stdin ignored, has prompt)
		// - `cat file | cline "explain"` -> OK (has stdin AND prompt)
		if (stdinInput === "" && !prompt) {
			printWarning("Empty input received from stdin. Please provide content to process.")
			exit(1)
		}

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

		// Handle --taskId flag to resume an existing task
		if (options.taskId) {
			await resumeTask(options.taskId, {
				...options,
				initialPrompt: effectivePrompt,
				stdinWasPiped,
			})
			return
		}

		if (effectivePrompt) {
			// Pass stdinWasPiped flag so runTask knows to use plain text mode
			await runTask(effectivePrompt, { ...options, stdinWasPiped })
		} else {
			// Show welcome prompt if no prompt given
			await showWelcome(options)
		}
	})

// Parse and run
program.parse()
