/**
 * Plain-text task runner for non-TTY environments (piped output, file redirection)
 * Optimized for CI/CD and piping - only outputs the final completion result to stdout.
 *
 * Design goals:
 * - stdout: Only the final completion result text (no prefix) - perfect for piping
 * - stderr: Errors and verbose output (won't break pipes)
 * - Enables workflows like: git diff | cline 'explain' | cline 'summarize'
 */

/* eslint-disable no-console */
// Console output is intentional here for plain text mode

import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import type { Controller } from "@/core/controller"
import { getRequestRegistry } from "@/core/controller/grpc-handler"
import { subscribeToState } from "@/core/controller/state/subscribeToState"
import { showTaskWithId } from "@/core/controller/task/showTaskWithId"
import { emitTaskStartedMessage } from "./task-start-output"

export interface PlainTextTaskOptions {
	controller: Controller
	/** Prompt for new task or message to send to resumed task */
	prompt?: string
	imageDataUrls?: string[]
	verbose?: boolean
	jsonOutput?: boolean
	/** Timeout in seconds (only applied when explicitly provided) */
	timeoutSeconds?: number
	/** Task ID to resume an existing task */
	taskId?: string
}

/**
 * Run a task with plain text output (no Ink, no ANSI codes)
 * Returns true if task completed successfully, false if error
 *
 * Output behavior:
 * - Non-JSON mode: Only writes final completion_result text to stdout
 * - JSON mode: Streams JSON lines to stdout as messages arrive (unchanged)
 * - Verbose mode: Progress info goes to stderr
 * - Errors: Always go to stderr
 */
export async function runPlainTextTask(options: PlainTextTaskOptions): Promise<boolean> {
	const { controller, prompt, imageDataUrls, verbose, jsonOutput } = options

	let completionResolve: (reason?: any) => void
	let completionReject: (reason?: any) => void
	const completionPromise = new Promise<string>((res, rej) => {
		completionResolve = res
		completionReject = rej
	})

	let hasError = false
	let hasEmittedTaskStarted = false
	// Track which messages have been processed (by timestamp)
	const processedMessages = new Map<number, string>()

	const isViewTaskOnly = Boolean(options.taskId) && !prompt

	// When resuming a task, we need to ignore completion_result messages that existed
	// before we sent our new prompt. This timestamp marks the cutoff - only completion
	// results AFTER this time should trigger task completion.
	const completionCutoffTs = Date.now()

	const emitTaskStarted = () => {
		if (hasEmittedTaskStarted) {
			return
		}

		const taskId = controller.task?.taskId
		if (!taskId) {
			return
		}

		emitTaskStartedMessage(taskId, Boolean(jsonOutput))
		hasEmittedTaskStarted = true
	}

	// Helper to process a message and track completion state
	const processMessage = (message: ClineMessage) => {
		const ts = message.ts || 0
		if (message.partial || processedMessages.has(ts)) {
			return
		}

		// JSON mode: stream all messages to stdout (existing behavior)
		if (jsonOutput) {
			process.stdout.write(JSON.stringify(message) + "\n")
		} else {
			handleMessageForPipeMode(message, verbose || false)
		}

		processedMessages.set(ts, message.text ?? "")

		// Check for completion (only on non-partial messages)
		// When resuming a task, only consider completion_result messages that appeared
		// AFTER we sent our resume message (ts > completionCutoffTs)
		if (message.say === "completion_result" || message.ask === "completion_result") {
			if (isViewTaskOnly || ts > completionCutoffTs) {
				completionResolve()
			}
		} else if (message.say === "error" || message.ask === "api_req_failed") {
			completionReject(message.text ?? "message.say error || message.ask api_req_failed")
		}
	}

	const requestId = "cline-cli-plain-text-task"
	subscribeToState(
		controller,
		{},
		async ({ stateJson }) => {
			try {
				const state = JSON.parse(stateJson) as ExtensionState
				for (const message of state.clineMessages ?? []) {
					processMessage(message)
				}
			} catch (error) {
				if (jsonOutput) {
					process.stdout.write(
						JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }) + "\n",
					)
				} else {
					process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
				}
				completionReject(error)
			}
		},
		requestId,
	)

	try {
		// Either resume an existing task or start a new one
		if (options.taskId) {
			// Load the existing task
			await showTaskWithId(controller, StringRequest.create({ value: options.taskId }))
			emitTaskStarted()

			// If a prompt was provided, send it as a message to the resumed task
			if (prompt && controller.task) {
				// Wait a moment for the task to fully load
				await new Promise((resolve) => setTimeout(resolve, 100))

				// Send the prompt as a response to any pending ask, or as a new message
				await controller.task.handleWebviewAskResponse("messageResponse", prompt)
			}
		} else if (prompt) {
			// Start a new task with the prompt
			await controller.initTask(prompt, imageDataUrls)
			emitTaskStarted()
		} else {
			throw new Error("Either taskId or prompt must be provided")
		}

		// Wait for task completion, with optional timeout only when explicitly configured
		if (options.timeoutSeconds) {
			const timeoutMs = options.timeoutSeconds * 1000
			const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
			await Promise.race([completionPromise, timeoutPromise])
		} else {
			await completionPromise
		}
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error)
		if (jsonOutput) {
			process.stdout.write(JSON.stringify({ type: "error", message: errMsg }) + "\n")
		} else {
			process.stderr.write(`Error: ${errMsg}\n`)
		}
		hasError = true
	} finally {
		getRequestRegistry().cancelRequest(requestId)
	}

	// non json mode outputs only the final complete message
	// (it should be the completion_result message)
	if (!jsonOutput && !verbose) {
		const msg = Array.from(processedMessages.entries())
			.sort(([aTs], [bTs]) => aTs - bTs)
			.map(([_, msg]) => msg)
			.at(-1)
		process.stdout.write(msg + "\n")
	}

	return !hasError
}

/**
 * Handle a message in pipe-optimized mode (non-JSON)
 * - Assistant response text (say: "text") is passed to the callback for buffering
 * - Errors go to stderr
 * - Verbose output goes to stderr
 * - Nothing else goes to stdout (stdout is reserved for final result only)
 */
function handleMessageForPipeMode(message: ClineMessage, verbose: boolean): void {
	const fullText = message.text ?? ""

	if (message.type === "say") {
		if (message.say === "error") {
			// Errors always go to stderr
			process.stderr.write(`Error: ${fullText}\n`)
		} else if (verbose) {
			// Verbose output goes to stderr so it doesn't interfere with piped stdout
			if (message.say === "task") {
				process.stderr.write(`${fullText}\n`)
			} else if (message.say === "text" && fullText) {
				process.stderr.write(`${fullText}\n`)
			} else if (message.say === "api_req_started") {
				process.stderr.write(`API request started\n`)
			} else if (message.say === "api_req_finished") {
				process.stderr.write(`API request finished\n`)
			} else if (message.say === "completion_result" && fullText) {
				process.stderr.write(`${fullText}\n`)
			} else if (fullText) {
				process.stderr.write(`${message.say}: ${fullText}\n`)
			}
		}
	} else if (message.type === "ask") {
		if (message.ask === "api_req_failed") {
			// Errors always go to stderr
			process.stderr.write(`Error: API request failed: ${fullText}\n`)
		} else if (message.ask === "tool" || message.ask === "command" || message.ask === "browser_action_launch") {
			// These require approval - warn via stderr
			process.stderr.write(`Waiting for approval (use --yolo for auto-approve): ${message.ask}\n`)
		} else if (verbose) {
			// Verbose output goes to stderr
			if (message.ask === "plan_mode_respond" || message.ask === "act_mode_respond") {
				if (fullText) {
					process.stderr.write(`${fullText}\n`)
				}
			} else if (message.ask === "completion_result") {
				process.stderr.write(`Task completed\n`)
			} else if (fullText) {
				process.stderr.write(`Question: ${fullText}\n`)
			}
		}
	}
}
