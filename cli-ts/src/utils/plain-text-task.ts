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
	const processedMessages = new Map<number, number>() // index -> last output text length
	let lastStreamingMessageIndex = -1 // track open streaming line that needs closing

	// Subscribe to state updates
	const originalPostState = controller.postStateToWebview.bind(controller)

	const handleStateUpdate = async () => {
		try {
			const state = await controller.getStateToPostToWebview()
			const messages = state.clineMessages || []

			// Process new messages
			for (let i = 0; i < messages.length; i++) {
				const message = messages[i]
				const currentTextLength = message.text?.length ?? 0
				const lastOutputLength = processedMessages.get(i) ?? 0

				// Skip if no new content to output
				if (currentTextLength <= lastOutputLength) continue

				// Close previous streaming line if we're moving to a different message
				if (lastStreamingMessageIndex >= 0 && lastStreamingMessageIndex !== i && !jsonOutput) {
					process.stdout.write("\n")
					lastStreamingMessageIndex = -1
				}

				processedMessages.set(i, currentTextLength)

				// Output the message
				if (jsonOutput) {
					process.stdout.write(JSON.stringify(message) + "\n")
				} else {
					const isStreaming = outputMessageAsText(message, verbose || false, lastOutputLength)
					// Track streaming state for text messages
					if (isStreaming) {
						lastStreamingMessageIndex = i
					} else {
						lastStreamingMessageIndex = -1
					}
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

			// Close streaming line on completion
			if (isComplete && lastStreamingMessageIndex >= 0 && !jsonOutput) {
				process.stdout.write("\n")
				lastStreamingMessageIndex = -1
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
			// Close any open streaming line before error message
			if (lastStreamingMessageIndex >= 0 && !jsonOutput) {
				process.stdout.write("\n")
				lastStreamingMessageIndex = -1
			}
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
		// Close any open streaming line
		if (lastStreamingMessageIndex >= 0 && !jsonOutput) {
			process.stdout.write("\n")
		}
		// Restore original postStateToWebview
		controller.postStateToWebview = originalPostState
		unsubscribePartial()
	}

	return !hasError
}

/**
 * Format a Cline message as plain text
 * @param previousLength - Length of text already output for this message (for streaming)
 * @returns true if this is a streaming message (caller should track for newline), false otherwise
 */
function outputMessageAsText(message: ClineMessage, verbose: boolean, previousLength: number = 0): boolean {
	const timestamp = new Date(message.ts || Date.now()).toLocaleTimeString()
	const fullText = message.text ?? ""

	if (!fullText) {
		// Skip partial messages without text
		return false
	}

	// For streaming text continuations, output only new content
	if (previousLength > 0 && message.type === "say" && message.say === "text") {
		process.stdout.write(fullText.slice(previousLength))
		return true // Still streaming
	}

	if (message.type === "say") {
		if (message.say === "task") {
			process.stdout.write(`[${timestamp}] Task: ${fullText}\n`)
		} else if (message.say === "text") {
			// First output of text message - write prefix but no newline (streaming)
			process.stdout.write(`[${timestamp}] ${fullText}`)
			return true // Streaming - newline will be added when stream ends
		} else if (message.say === "completion_result" && fullText) {
			process.stdout.write(`[${timestamp}] Completed: ${fullText}\n`)
		} else if (message.say === "error") {
			process.stderr.write(`[${timestamp}] Error: ${fullText}\n`)
		} else if (message.say === "api_req_started") {
			if (verbose) {
				process.stdout.write(`[${timestamp}] API request started\n`)
			}
		} else if (message.say === "api_req_finished") {
			if (verbose) {
				process.stdout.write(`[${timestamp}] API request finished\n`)
			}
		} else if (verbose) {
			process.stdout.write(`[${timestamp}] ${message.say}: ${fullText}\n`)
		}
	} else if (message.type === "ask") {
		if (message.ask === "completion_result") {
			process.stdout.write(`[${timestamp}] Task completed\n`)
		} else if (message.ask === "api_req_failed") {
			process.stderr.write(`[${timestamp}] API request failed: ${fullText}\n`)
		} else if (message.ask === "tool" || message.ask === "command" || message.ask === "browser_action_launch") {
			// These require approval - in non-interactive mode, warn the user
			process.stderr.write(`[${timestamp}] Waiting for approval (use --yolo for auto-approve): ${message.ask}\n`)
		} else if (verbose) {
			process.stdout.write(`[${timestamp}] Question: ${fullText}\n`)
		}
	}

	return false
}
