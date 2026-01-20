/**
 * REPL (Read-Eval-Print Loop) for chat command
 *
 * Handles readline setup, event handling, and the main interaction loop.
 */

import type { ApiProvider } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import readline from "readline"
import type { Controller } from "@/core/controller"
import { CliWebviewAdapter } from "../../../core/cli-webview-adapter.js"
import { disposeEmbeddedController } from "../../../core/embedded-controller.js"
import type { OutputFormatter } from "../../../core/output/types.js"
import type { CliConfig } from "../../../types/config.js"
import type { Logger } from "../../../types/logger.js"
import { createCompleter } from "./completer.js"
import { checkForPendingInput, isCompletionState, isFailureState } from "./input-checker.js"
import { getModelIdForProvider } from "./model-utils.js"
import { buildPromptString } from "./prompt.js"
import type { ChatSession } from "./session.js"
import { processSlashCommand } from "./slash-commands/index.js"

/** Yolo mode timeout: 5 minutes in milliseconds */
const YOLO_TIMEOUT_MS = 5 * 60 * 1000

/** Yolo mode max consecutive failures before abort */
const YOLO_MAX_FAILURES = 3

/**
 * Options for starting the REPL
 */
export interface ReplOptions {
	session: ChatSession
	controller: Controller
	formatter: OutputFormatter
	logger: Logger
	config: CliConfig
	initialPrompt?: string
	resumeTaskId?: string
}

/**
 * Start the interactive REPL loop
 */
export async function startRepl(options: ReplOptions): Promise<void> {
	const { session, controller, formatter, logger, config, initialPrompt, resumeTaskId } = options

	// Create webview adapter for output
	session.adapter = new CliWebviewAdapter(controller, formatter)

	// Track if we started with a prompt (AI will be processing)
	let startedWithPrompt = false

	// Start or resume task
	if (resumeTaskId) {
		// Resume existing task
		const history = await controller.getTaskWithId(resumeTaskId)
		if (!history) {
			throw new Error(`Task not found: ${resumeTaskId}`)
		}
		session.taskId = await controller.initTask(undefined, undefined, undefined, history.historyItem)
		formatter.info(`Resumed task: ${session.taskId}`)
	} else if (initialPrompt) {
		// Start new task with prompt
		startedWithPrompt = true
		session.taskId = await controller.initTask(initialPrompt)
		formatter.info(`Started task: ${session.taskId}`)
		// Enable spinner since AI will be processing
		session.adapter?.setProcessing(true)
	}

	// Display welcome message
	displayWelcome(formatter, session, controller)

	// Output existing messages if resuming
	if (session.taskId && session.adapter) {
		session.adapter.outputAllMessages()
	}

	// Create readline interface with @ file completion
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: "> ", // Default prompt, will be updated dynamically
		completer: createCompleter(process.cwd()),
	})

	// Track if we're currently processing (AI is working)
	let isProcessing = startedWithPrompt
	// Track previous awaiting states to detect transitions
	let wasAwaitingInput = false

	// Helper to set processing state and update spinner
	function setProcessingState(processing: boolean): void {
		isProcessing = processing
		session.adapter?.setProcessing(processing)
	}

	// Helper to update the prompt string (but not necessarily show it)
	async function updatePromptString(): Promise<void> {
		const currentState = await controller.getStateToPostToWebview()
		const mode = (currentState.mode || "act") as Mode
		const provider = (
			mode === "plan"
				? currentState.apiConfiguration?.planModeApiProvider
				: currentState.apiConfiguration?.actModeApiProvider
		) as ApiProvider | undefined
		const modelId = getModelIdForProvider(currentState.apiConfiguration, provider, mode)
		const promptStr = buildPromptString(mode, provider, modelId)
		rl.setPrompt(promptStr)
	}

	// Helper to show the prompt (call after updating)
	function showPrompt(): void {
		rl.prompt()
	}

	// Start listening for state updates
	session.adapter.startListening((messages) => {
		const pendingState = checkForPendingInput(messages)
		session.awaitingApproval = pendingState.awaitingApproval
		session.awaitingInput = pendingState.awaitingInput

		// YOLO MODE: Auto-respond to pending inputs
		if (session.yoloMode && controller.task) {
			// Check for task completion first
			if (isCompletionState(messages)) {
				formatter.success("\n[YOLO] Task completed!")
				session.isRunning = false
				rl.close()
				return
			}

			// Check for timeout (5 minutes)
			if (session.yoloActionStartTime && Date.now() - session.yoloActionStartTime > YOLO_TIMEOUT_MS) {
				formatter.error("\n[YOLO] Action timed out after 5 minutes. Aborting.")
				session.isRunning = false
				rl.close()
				return
			}

			// Check for failure state
			const failureCheck = isFailureState(messages)
			if (failureCheck.isFailure) {
				if (session.yoloLastFailedAction === failureCheck.actionKey) {
					session.yoloFailureCount++
				} else {
					session.yoloLastFailedAction = failureCheck.actionKey
					session.yoloFailureCount = 1
				}

				if (session.yoloFailureCount >= YOLO_MAX_FAILURES) {
					formatter.error(`\n[YOLO] Same action failed ${YOLO_MAX_FAILURES} times. Aborting.`)
					session.isRunning = false
					rl.close()
					return
				}

				// Auto-retry: approve the retry
				formatter.warn(`[YOLO] Action failed (attempt ${session.yoloFailureCount}/${YOLO_MAX_FAILURES}), retrying...`)
				session.yoloActionStartTime = Date.now()
				setProcessingState(true)
				wasAwaitingInput = false
				controller.task.handleWebviewAskResponse("yesButtonClicked")
				return
			} else {
				// Reset failure tracking on success
				session.yoloFailureCount = 0
				session.yoloLastFailedAction = null
			}

			// Auto-approve pending approvals
			if (pendingState.awaitingApproval) {
				logger.debug("[YOLO] Auto-approving action")
				session.yoloActionStartTime = Date.now()
				setProcessingState(true)
				wasAwaitingInput = false
				controller.task.handleWebviewAskResponse("yesButtonClicked")
				session.awaitingApproval = false
				return
			}

			// Auto-respond to input requests with "proceed"
			if (pendingState.awaitingInput) {
				logger.debug("[YOLO] Auto-responding with 'proceed'")
				session.yoloActionStartTime = Date.now()
				setProcessingState(true)
				wasAwaitingInput = false
				controller.task.handleWebviewAskResponse("messageResponse", "proceed")
				session.awaitingInput = false
				return
			}
		}

		// Normal mode: Detect transition from processing to awaiting input
		const nowAwaitingInput = pendingState.awaitingApproval || pendingState.awaitingInput
		if (isProcessing && nowAwaitingInput && !wasAwaitingInput) {
			// AI just finished and is now waiting for input - show prompt
			setProcessingState(false)
			updatePromptString().then(() => showPrompt())
		}
		wasAwaitingInput = nowAwaitingInput
	})

	// Build command context
	const commandContext = {
		session,
		fmt: formatter,
		logger,
		config,
		controller,
	}

	// Handle line input
	rl.on("line", async (line: string) => {
		const input = line.trim()

		if (!input) {
			// Empty input - just show prompt again
			await updatePromptString()
			showPrompt()
			return
		}

		// Check for chat commands
		if (input.startsWith("/")) {
			await processSlashCommand(input, commandContext)
			if (!session.isRunning) {
				rl.close()
				return
			}
			// Commands complete immediately, show prompt
			await updatePromptString()
			showPrompt()
			return
		}

		// Handle approval shortcuts
		if (session.awaitingApproval) {
			const lowerInput = input.toLowerCase()
			if (lowerInput === "y" || lowerInput === "yes" || lowerInput === "approve") {
				if (controller.task) {
					setProcessingState(true) // AI will start processing
					wasAwaitingInput = false
					await controller.task.handleWebviewAskResponse("yesButtonClicked")
					session.awaitingApproval = false
				}
				// Don't show prompt - wait for AI to finish
				return
			}
			if (lowerInput === "n" || lowerInput === "no" || lowerInput === "deny") {
				if (controller.task) {
					setProcessingState(true) // AI will start processing
					wasAwaitingInput = false
					await controller.task.handleWebviewAskResponse("noButtonClicked")
					session.awaitingApproval = false
				}
				// Don't show prompt - wait for AI to finish
				return
			}
		}

		// If no active task, start a new one
		if (!session.taskId) {
			setProcessingState(true) // AI will start processing
			wasAwaitingInput = false
			session.taskId = await controller.initTask(input)
			formatter.info(`Started task: ${session.taskId}`)
			session.adapter?.resetMessageCounter()
			// Don't show prompt - wait for AI to finish
		} else if (controller.task) {
			// Check if input is a numbered option selection
			let messageToSend = input
			if (session.awaitingInput && session.adapter) {
				const options = session.adapter.currentOptions
				const num = parseInt(input, 10)
				if (!Number.isNaN(num) && num >= 1 && num <= options.length) {
					messageToSend = options[num - 1]
				}
			}

			setProcessingState(true) // AI will start processing
			wasAwaitingInput = false
			// Send message to existing task
			await controller.task.handleWebviewAskResponse("messageResponse", messageToSend)
			// Don't show prompt - wait for AI to finish
		}
	})

	// Handle close
	rl.on("close", async () => {
		formatter.raw("")
		formatter.info("Chat session ended")

		// Stop listening and cleanup
		session.adapter?.stopListening()
		await disposeEmbeddedController(logger)

		process.exit(0)
	})

	// Handle Ctrl+C
	rl.on("SIGINT", () => {
		formatter.raw("")
		formatter.info("Chat session ended (interrupted)")
		rl.close()
	})

	// Start prompt with current state (only if not already processing)
	await updatePromptString()
	if (!isProcessing) {
		showPrompt()
	}
}

/**
 * Display the welcome message
 */
async function displayWelcome(formatter: OutputFormatter, session: ChatSession, controller: Controller): Promise<void> {
	formatter.raw("")
	formatter.info("═".repeat(60))
	if (session.yoloMode) {
		formatter.info("  Cline Interactive Chat Mode [YOLO]")
	} else {
		formatter.info("  Cline Interactive Chat Mode")
	}
	formatter.info("═".repeat(60))
	if (session.taskId) {
		formatter.info(`Task: ${session.taskId}`)
	}
	const state = await controller.getStateToPostToWebview()
	formatter.info(`Mode: ${state.mode || "act"}`)
	if (session.yoloMode) {
		formatter.info("YOLO: Auto-approving all actions (5min timeout, 3 retries max)")
	}
	formatter.raw("")
	if (!session.yoloMode) {
		formatter.info("Type your message and press Enter to send.")
		formatter.info("Type /help for available commands, /quit to exit.")
	}
	formatter.raw("─".repeat(60))
	formatter.raw("")
}
