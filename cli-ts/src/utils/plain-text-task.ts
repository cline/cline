/**
 * Plain-text task runner for non-TTY environments (piped output, file redirection)
 * Outputs clean text without ANSI codes or Ink rendering
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
 */
export async function runPlainTextTask(options: PlainTextTaskOptions): Promise<boolean> {
	const { controller, prompt, imageDataUrls, verbose, jsonOutput } = options

	// Track completion state
	let isComplete = false
	let hasError = false
	// Track which messages have been output (by timestamp)
	const processedMessages = new Map<number, number>()

	// Helper to output a message and track completion state
	const outputMessage = (message: ClineMessage) => {
		const ts = message.ts || 0

		// Only output complete messages (not partial streaming updates)
		// This prevents duplicate output and ensures clean, final content
		if (message.partial) {
			return
		}

		// Skip if we've already output this message
		if (processedMessages.has(ts)) {
			return
		}

		processedMessages.set(ts, message.text?.length ?? 0)

		// Output the message
		if (jsonOutput) {
			process.stdout.write(JSON.stringify(message) + "\n")
		} else {
			outputMessageAsText(message, verbose || false)
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
				outputMessage(message)
			}
		} catch (error) {
			if (jsonOutput) {
				process.stdout.write(
					JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }) + "\n",
				)
			} else {
				process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}` + "\n")
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
	// output messages when partial=false (complete)
	const unsubscribePartial = registerPartialMessageCallback((protoMessage) => {
		try {
			const message = convertProtoToClineMessage(protoMessage) as ClineMessage
			outputMessage(message)
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
				process.stderr.write("Error: Task timeout" + "\n")
			}
			hasError = true
		}
	} catch (error) {
		if (jsonOutput) {
			process.stdout.write(
				JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }) + "\n",
			)
		} else {
			process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}` + "\n")
		}
		hasError = true
	} finally {
		// Restore original postStateToWebview
		controller.postStateToWebview = originalPostState
		unsubscribePartial()
	}

	return !hasError
}

/**
 * Format a Cline message as plain text
 * Only called for complete (non-partial) messages
 */
function outputMessageAsText(message: ClineMessage, verbose: boolean): void {
	const fullText = message.text ?? ""

	if (message.type === "say") {
		if (message.say === "task") {
			process.stdout.write(`Task: ${fullText}\n`)
		} else if (message.say === "text") {
			if (fullText) {
				process.stdout.write(`${fullText}\n`)
			}
		} else if (message.say === "completion_result" && fullText) {
			process.stdout.write(`Completed: ${fullText}\n`)
		} else if (message.say === "error") {
			process.stderr.write(`Error: ${fullText}\n`)
		} else if (message.say === "api_req_started") {
			if (verbose) {
				process.stdout.write(`API request started\n`)
			}
		} else if (message.say === "api_req_finished") {
			if (verbose) {
				process.stdout.write(`API request finished\n`)
			}
		} else if (verbose) {
			process.stdout.write(`${message.say}: ${fullText}\n`)
		}
	} else if (message.type === "ask") {
		if (message.ask === "plan_mode_respond" || message.ask === "act_mode_respond") {
			// Plan/Act mode responses - output the response text
			if (fullText) {
				process.stdout.write(`${fullText}\n`)
			}
		} else if (message.ask === "completion_result") {
			process.stdout.write(`Task completed\n`)
		} else if (message.ask === "api_req_failed") {
			process.stderr.write(`API request failed: ${fullText}\n`)
		} else if (message.ask === "tool" || message.ask === "command" || message.ask === "browser_action_launch") {
			// These require approval - in non-interactive mode, warn the user
			process.stderr.write(`Waiting for approval (use --yolo for auto-approve): ${message.ask}\n`)
		} else if (verbose) {
			process.stdout.write(`Question: ${fullText}\n`)
		}
	}
}
