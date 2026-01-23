/**
 * Plain-text task runner for non-TTY environments (piped output, file redirection)
 * Outputs clean text without ANSI codes or Ink rendering
 */

/* eslint-disable no-console */
// Console output is intentional here for plain text mode

import { registerPartialMessageCallback } from "@core/controller/ui/subscribeToPartialMessage"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Controller } from "@/core/controller"

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
	const processedMessages = new Set<number>()

	// Subscribe to state updates
	const originalPostState = controller.postStateToWebview.bind(controller)

	const handleStateUpdate = async () => {
		try {
			const state = await controller.getStateToPostToWebview()
			const messages = state.clineMessages || []

			// Process new messages
			for (let i = 0; i < messages.length; i++) {
				if (processedMessages.has(i)) continue

				const message = messages[i]
				processedMessages.add(i)

				// Output the message
				if (jsonOutput) {
					process.stdout.write(JSON.stringify(message) + "\n")
				} else {
					outputMessageAsText(message, verbose || false)
				}

				// Check for completion
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

	// Subscribe to partial message updates (for streaming)
	const unsubscribePartial = registerPartialMessageCallback(() => {
		// Partial updates are handled via postStateToWebview
	})

	try {
		// Get initial state
		await handleStateUpdate()

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
		} else if (!hasError && !jsonOutput) {
			// Print completion message for non-JSON mode
			process.stdout.write("\nTask completed successfully\n")
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
 */
function outputMessageAsText(message: ClineMessage, verbose: boolean) {
	const timestamp = new Date(message.ts || Date.now()).toLocaleTimeString()

	if (message.type === "say") {
		if (message.say === "task") {
			process.stdout.write(`[${timestamp}] Task: ${message.text || ""}\n`)
		} else if (message.say === "text") {
			process.stdout.write(`[${timestamp}] ${message.text || ""}\n`)
		} else if (message.say === "completion_result") {
			process.stdout.write(`[${timestamp}] Completed: ${message.text || ""}\n`)
		} else if (message.say === "api_req_started") {
			if (verbose) {
				process.stdout.write(`[${timestamp}] API request started\n`)
			}
		} else if (message.say === "api_req_finished") {
			if (verbose) {
				process.stdout.write(`[${timestamp}] API request finished\n`)
			}
		} else if (verbose) {
			process.stdout.write(`[${timestamp}] ${message.say}: ${message.text || ""}\n`)
		}
	} else if (message.type === "ask") {
		if (message.ask === "completion_result") {
			process.stdout.write(`[${timestamp}] Task completed\n`)
		} else if (verbose) {
			process.stdout.write(`[${timestamp}] Question: ${message.text || ""}\n`)
		}
	}
}
