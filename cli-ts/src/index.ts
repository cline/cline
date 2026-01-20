/**
 * Cline CLI - TypeScript implementation with React Ink
 */

import path from "node:path"
import { Command } from "commander"
import { render } from "ink"
import React from "react"
import { Controller } from "@/core/controller"
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
import { restoreConsole } from "./console"
import { print, printError, printInfo, separator } from "./display"
import { initializeCliContext } from "./vscode-context"

const VERSION = "0.0.0"

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

	const logToChannel = options.verbose ? (message: string) => printInfo(message) : () => {}

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

	if (!BannerService.isInitialized()) {
		BannerService.initialize(controller)
	}

	return { extensionContext, dataDir: DATA_DIR, extensionDir: EXTENSION_DIR, workspacePath, controller }
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
	options: { switch?: string; model?: string; verbose?: boolean; cwd?: string; config?: string },
) {
	const ctx = await initializeCli(options)

	if (options.switch) {
		StateManager.get().setGlobalState("mode", options.switch === "plan" ? "plan" : "act")
	}
	if (options.model) {
		const selectedMode = StateManager.get().getGlobalSettingsKey("mode") || "act"
		const key = selectedMode === "act" ? "actModeApiModelId" : "planModeApiModelId"
		StateManager.get().setGlobalState(key, options.model)
	}

	printInfo(`Starting Cline task...`)
	printInfo(`Working directory: ${ctx.workspacePath}`)
	print(separator())

	let isComplete = false
	let taskError = false

	const { waitUntilExit, unmount } = render(
		React.createElement(App, {
			view: "task",
			taskId: prompt.substring(0, 30),
			verbose: options.verbose,
			controller: ctx.controller,
			onComplete: () => {
				isComplete = true
			},
			onError: () => {
				taskError = true
				isComplete = true
			},
		}),
	)

	await ctx.controller.initTask(prompt)

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
		await ctx.controller.dispose()
		await ErrorService.get().dispose()
	}
}

/**
 * List task history
 */
async function listHistory(options: { config?: string; limit?: number }) {
	const ctx = await initializeCli(options)

	const taskHistory = StateManager.get().getGlobalStateKey("taskHistory") || []
	const limit = options.limit || 10
	const recentTasks = taskHistory.slice(0, limit).reverse()

	if (recentTasks.length === 0) {
		printInfo("No task history found.")
		await ctx.controller.dispose()
		await ErrorService.get().dispose()
		return
	}

	await runInkApp(
		React.createElement(App, { view: "history", historyItems: recentTasks, controller: ctx.controller }),
		async () => {
			await ctx.controller.dispose()
			await ErrorService.get().dispose()
		},
	)
}

/**
 * Show current configuration
 */
async function showConfig(options: { config?: string }) {
	const ctx = await initializeCli(options)
	const stateManager = StateManager.get()

	await runInkApp(
		React.createElement(App, {
			view: "config",
			dataDir: ctx.dataDir,
			globalState: stateManager.getAllGlobalStateEntries(),
			workspaceState: stateManager.getAllWorkspaceStateEntries(),
		}),
		async () => {
			await ErrorService.get().dispose()
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
			onComplete: () => {},
			onError: () => {
				authError = true
			},
			authQuickSetup: quickSetup,
		}),
		async () => {
			await ctx.controller.dispose()
			await ErrorService.get().dispose()
		},
	)

	if (authError) {
		process.exit(1)
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
