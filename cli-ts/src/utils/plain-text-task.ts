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

import { registerPartialMessageCallback } from "@core/controller/ui/subscribeToPartialMessage"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { convertProtoToClineMessage } from "@shared/proto-conversions/cline-message"
import type { Controller } from "@/core/controller"
import { setTerminalTitle } from "./display"

export interface PlainTextTaskOptions {
	controller: Controller
	prompt: string
	imageDataUrls?: string[]
	verbose?: boolean
	jsonOutput?: boolean
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

	// Track completion state
	let isComplete = false
	let hasError = false
	// Track which messages have been processed (by timestamp)
	const processedMessages = new Map<number, number>()
	// Store the assistant's response text (from say: "text" messages)
	// This is the actual AI response that should be piped to the next command
	let assistantResponseText: string | null = null

	// Helper to process a message and track completion state
	const processMessage = (message: ClineMessage) => {
		const ts = message.ts || 0

		// Only process complete messages (not partial streaming updates)
		// Skip if we've already processed this message
		// This prevents duplicate processing and ensures clean, final content
		if (message.partial || processedMessages.has(ts)) {
			return
		}

		processedMessages.set(ts, message.text?.length ?? 0)

		// JSON mode: stream all messages to stdout (existing behavior)
		if (jsonOutput) {
			process.stdout.write(JSON.stringify(message) + "\n")
		} else {
			// Non-JSON mode: buffer assistant response, send verbose/errors to stderr
			handleMessageForPipeMode(message, verbose || false, (text) => {
				assistantResponseText = text
			})
		}

		// Check for completion (only on non-partial messages)
		if (
			message.say === "completion_result" ||
			message.ask === "completion_result" ||
			message.say === "error" ||
			message.ask === "api_req_failed"
		) {
			isComplete = true
			if (message.say === "error" || message.ask === "api_req_failed") {
				hasError = true
			}
		}
	}

	// Subscribe to state updates
	const originalPostState = controller.postStateToWebview.bind(controller)

	const handleStateUpdate = async () => {
		try {
			const state = await controller.getStateToPostToWebview()
			const messages = state.clineMessages || []

			// Process all messages
			for (const message of messages) {
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
			hasError = true
			isComplete = true
		}
	}

	// Override postStateToWebview to capture state updates
	controller.postStateToWebview = async () => {
		await originalPostState()
		await handleStateUpdate()
	}

	// Subscribe to message updates to detect when messages become complete
	// This callback is called frequently during LLM streaming, but we only
	// process messages when partial=false (complete)
	const unsubscribePartial = registerPartialMessageCallback((protoMessage) => {
		try {
			const message = convertProtoToClineMessage(protoMessage) as ClineMessage
			processMessage(message)
		} catch {
			// Ignore conversion errors for partial messages
		}
	})

	try {
		// Get initial state
		await handleStateUpdate()

		// Set terminal title to the task prompt
		setTerminalTitle(prompt)

		// Start the task
		await controller.initTask(prompt, imageDataUrls)

		// Wait for completion with timeout
		const timeout = 10 * 60 * 1000 // 10 minutes
		const startTime = Date.now()

		while (!isComplete && Date.now() - startTime < timeout) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		if (!isComplete) {
			if (jsonOutput) {
				process.stdout.write(JSON.stringify({ type: "error", message: "Task timeout" }) + "\n")
			} else {
				process.stderr.write("Error: Task timeout\n")
			}
			hasError = true
		}
	} catch (error) {
		if (jsonOutput) {
			process.stdout.write(
				JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }) + "\n",
			)
		} else {
			process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
		}
		hasError = true
	} finally {
		// Restore original postStateToWebview
		controller.postStateToWebview = originalPostState
		unsubscribePartial()
	}

	// In non-JSON mode, write the assistant's response to stdout
	// This is the ONLY thing written to stdout, making it perfect for piping
	if (!jsonOutput && assistantResponseText && !hasError) {
		// Write to stdout and wait for it to drain before returning
		// This is critical for piping to work correctly - the next command
		// in the pipe won't receive data until stdout is flushed
		await new Promise<void>((resolve) => {
			const flushed = process.stdout.write(assistantResponseText + "\n")
			if (flushed) {
				resolve()
			} else {
				process.stdout.once("drain", resolve)
			}
		})
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
function handleMessageForPipeMode(message: ClineMessage, verbose: boolean, onAssistantResponse: (text: string) => void): void {
	const fullText = message.text ?? ""

	if (message.type === "say") {
		if (message.say === "text" && fullText) {
			// Buffer the assistant's response text - this is what gets piped to stdout
			// Each new "text" message overwrites the previous one, so we get the latest response
			onAssistantResponse(fullText)
		} else if (message.say === "error") {
			// Errors always go to stderr
			process.stderr.write(`Error: ${fullText}\n`)
		} else if (verbose) {
			// Verbose output goes to stderr so it doesn't interfere with piped stdout
			if (message.say === "task") {
				process.stderr.write(`[verbose] Task: ${fullText}\n`)
			} else if (message.say === "text" && fullText) {
				process.stderr.write(`[verbose] ${fullText}\n`)
			} else if (message.say === "api_req_started") {
				process.stderr.write(`[verbose] API request started\n`)
			} else if (message.say === "api_req_finished") {
				process.stderr.write(`[verbose] API request finished\n`)
			} else if (message.say === "completion_result" && fullText) {
				process.stderr.write(`[verbose] Completed: ${fullText}\n`)
			} else if (fullText) {
				process.stderr.write(`[verbose] ${message.say}: ${fullText}\n`)
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
					process.stderr.write(`[verbose] ${fullText}\n`)
				}
			} else if (message.ask === "completion_result") {
				process.stderr.write(`[verbose] Task completed\n`)
			} else if (fullText) {
				process.stderr.write(`[verbose] Question: ${fullText}\n`)
			}
		}
	}
}
