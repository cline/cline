/**
 * CommandOrchestrator - Shared command execution orchestration logic.
 *
 * This module contains the common orchestration logic for command execution
 * that is shared between VSCode and Standalone terminal modes. It handles:
 * - Output buffering and chunking
 * - User interaction (ask/say callbacks)
 * - "Proceed While Running" behavior
 * - Timeout handling
 * - Result formatting
 *
 * The actual process spawning/management is handled by the TerminalProcess
 * implementations (VscodeTerminalProcess, StandaloneTerminalProcess).
 */

import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { Logger } from "@services/logging/Logger"
import { TerminalHangStage, TerminalUserInterventionAction, telemetryService } from "@services/telemetry"
import { COMMAND_CANCEL_TOKEN } from "@shared/ExtensionMessage"
import type {
	CommandExecutorCallbacks,
	ITerminalManager,
	OrchestrationOptions,
	OrchestrationResult,
	TerminalProcessResultPromise,
} from "./types"

// Chunked terminal output buffering constants
export const CHUNK_LINE_COUNT = 20
export const CHUNK_BYTE_SIZE = 2048 // 2KB
export const CHUNK_DEBOUNCE_MS = 100
export const BUFFER_STUCK_TIMEOUT_MS = 6000 // 6 seconds
export const COMPLETION_TIMEOUT_MS = 6000 // 6 seconds

// Re-export types for convenience
export type { OrchestrationOptions, OrchestrationResult } from "./types"

/**
 * Orchestrate command execution with shared logic for buffering, user interaction, and result formatting.
 *
 * @param process The terminal process (implements ITerminalProcess)
 * @param terminalManager The terminal manager (for processOutput)
 * @param callbacks The executor callbacks for UI interaction
 * @param options Orchestration options
 * @returns The orchestration result
 */
export async function orchestrateCommandExecution(
	process: TerminalProcessResultPromise,
	terminalManager: ITerminalManager,
	callbacks: CommandExecutorCallbacks,
	options: OrchestrationOptions,
): Promise<OrchestrationResult> {
	const { command, timeoutSeconds, onOutputLine, showShellIntegrationSuggestion } = options

	// Track command execution state
	callbacks.updateBackgroundCommandState(true)

	const clearCommandState = async () => {
		callbacks.updateBackgroundCommandState(false)

		// Mark the command message as completed
		const clineMessages = callbacks.getClineMessages()
		const lastCommandIndex = findLastIndex(clineMessages, (m) => m.ask === "command" || m.say === "command")
		if (lastCommandIndex !== -1) {
			await callbacks.updateClineMessage(lastCommandIndex, {
				commandCompleted: true,
			})
		}
	}

	process.once("completed", clearCommandState)
	process.once("error", clearCommandState)
	process.catch(() => {
		clearCommandState()
	})

	let userFeedback: { text?: string; images?: string[]; files?: string[] } | undefined
	let didContinue = false
	let didCancelViaUi = false

	// Chunked terminal output buffering
	let outputBuffer: string[] = []
	let outputBufferSize: number = 0
	let chunkTimer: NodeJS.Timeout | null = null

	// Track if buffer gets stuck
	let bufferStuckTimer: NodeJS.Timeout | null = null

	/**
	 * Flush buffered output to the UI using ask() which waits for user response.
	 * This is the key mechanism for "Proceed While Running" - when user clicks the button,
	 * the ask() returns with response "yesButtonClicked".
	 */
	const flushBuffer = async (force = false) => {
		if (outputBuffer.length === 0 && !force) {
			return
		}
		const chunk = outputBuffer.join("\n")
		outputBuffer = []
		outputBufferSize = 0

		if (!didContinue) {
			// Start timer to detect if buffer gets stuck
			bufferStuckTimer = setTimeout(() => {
				telemetryService.captureTerminalHang(TerminalHangStage.BUFFER_STUCK)
				bufferStuckTimer = null
			}, BUFFER_STUCK_TIMEOUT_MS)

			try {
				// Use ask() to present output and wait for user response
				// This enables "Proceed While Running" button functionality
				const { response, text, images, files } = await callbacks.ask("command_output", chunk)

				if (response === "yesButtonClicked") {
					// Track when user clicks "Proceed While Running"
					telemetryService.captureTerminalUserIntervention(TerminalUserInterventionAction.PROCESS_WHILE_RUNNING)
					// Proceed while running - but still capture user feedback if provided
					if (text || (images && images.length > 0) || (files && files.length > 0)) {
						userFeedback = { text, images, files }
					}
					didContinue = true
					process.continue()
				} else if (response === "noButtonClicked" && text === COMMAND_CANCEL_TOKEN) {
					telemetryService.captureTerminalUserIntervention(TerminalUserInterventionAction.CANCELLED)
					didCancelViaUi = true
					userFeedback = undefined
					didContinue = true
					process.continue()
					outputBuffer = []
					outputBufferSize = 0
					await callbacks.say("command_output", "Command cancelled")
				} else {
					userFeedback = { text, images, files }
					didContinue = true
					process.continue()
					// If more output accumulated, flush again
					if (outputBuffer.length > 0) {
						await flushBuffer()
					}
				}
			} catch {
				Logger.error("Error while asking for command output")
			} finally {
				// Clear the stuck timer
				if (bufferStuckTimer) {
					clearTimeout(bufferStuckTimer)
					bufferStuckTimer = null
				}
			}
		} else {
			// After "Proceed While Running": stream output directly to UI
			await callbacks.say("command_output", chunk)
		}
	}

	const scheduleFlush = () => {
		if (chunkTimer) {
			clearTimeout(chunkTimer)
		}
		chunkTimer = setTimeout(async () => await flushBuffer(), CHUNK_DEBOUNCE_MS)
	}

	const outputLines: string[] = []
	process.on("line", async (line: string) => {
		if (didCancelViaUi) {
			return
		}
		outputLines.push(line)

		// Notify caller about output line (for background command tracking)
		if (onOutputLine) {
			onOutputLine(line)
		}

		// Apply buffered streaming
		if (!didContinue) {
			outputBuffer.push(line)
			outputBufferSize += Buffer.byteLength(line, "utf8")
			// Flush if buffer is large enough
			if (outputBuffer.length >= CHUNK_LINE_COUNT || outputBufferSize >= CHUNK_BYTE_SIZE) {
				await flushBuffer()
			} else {
				scheduleFlush()
			}
		} else {
			// After "Proceed While Running": stream output directly to UI
			await callbacks.say("command_output", line)
		}
	})

	let completed = false
	let completionTimer: NodeJS.Timeout | null = null

	// Start timer to detect if waiting for completion takes too long
	completionTimer = setTimeout(() => {
		if (!completed) {
			telemetryService.captureTerminalHang(TerminalHangStage.WAITING_FOR_COMPLETION)
			completionTimer = null
		}
	}, COMPLETION_TIMEOUT_MS)

	process.once("completed", async () => {
		completed = true
		// Clear the completion timer
		if (completionTimer) {
			clearTimeout(completionTimer)
			completionTimer = null
		}
		// Flush any remaining buffered output
		if (!didContinue && outputBuffer.length > 0) {
			if (chunkTimer) {
				clearTimeout(chunkTimer)
				chunkTimer = null
			}
			await flushBuffer(true)
		}
	})

	process.once("no_shell_integration", async () => {
		if (showShellIntegrationSuggestion) {
			await callbacks.say("shell_integration_warning_with_suggestion")
		} else {
			await callbacks.say("shell_integration_warning")
		}
	})

	// Handle timeout if specified, or wait for process to complete
	if (!didCancelViaUi) {
		if (timeoutSeconds) {
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(new Error("COMMAND_TIMEOUT"))
				}, timeoutSeconds * 1000)
			})

			try {
				await Promise.race([process, timeoutPromise])
			} catch (error: any) {
				if (error.message === "COMMAND_TIMEOUT") {
					// Timeout triggers "Proceed While Running" behavior
					didContinue = true
					process.continue()

					// Clear all our timers
					if (chunkTimer) {
						clearTimeout(chunkTimer)
						chunkTimer = null
					}
					if (completionTimer) {
						clearTimeout(completionTimer)
						completionTimer = null
					}

					// Process any output we captured before timeout
					await setTimeoutPromise(50)
					const result = terminalManager.processOutput(outputLines)

					return {
						userRejected: false,
						result: `Command execution timed out after ${timeoutSeconds} seconds. ${result.length > 0 ? `\nOutput so far:\n${result}` : ""}`,
						completed: false,
						outputLines,
					}
				}

				// Re-throw other errors
				throw error
			}
		} else {
			// No timeout - wait for process to complete
			await process
		}
	}

	// Clear timer if process completes normally
	if (completionTimer) {
		clearTimeout(completionTimer)
		completionTimer = null
	}

	// Wait for a short delay to ensure all messages are sent to the webview
	await setTimeoutPromise(50)

	const result = terminalManager.processOutput(outputLines)

	if (didCancelViaUi) {
		return {
			userRejected: true,
			result: formatResponse.toolResult(
				`Command cancelled. ${result.length > 0 ? `\nOutput captured before cancellation:\n${result}` : ""}`,
			),
			completed: false,
			outputLines,
		}
	}

	if (userFeedback) {
		await callbacks.say("user_feedback", userFeedback.text, userFeedback.images, userFeedback.files)

		let fileContentString = ""
		if (userFeedback.files && userFeedback.files.length > 0) {
			fileContentString = await processFilesIntoText(userFeedback.files)
		}

		return {
			userRejected: true,
			result: formatResponse.toolResult(
				`Command is still running in the user's terminal.${
					result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
				}\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
				userFeedback.images,
				fileContentString,
			),
			completed: false,
			outputLines,
		}
	}

	if (completed) {
		return {
			userRejected: false,
			result: `Command executed.${result.length > 0 ? `\nOutput:\n${result}` : ""}`,
			completed: true,
			outputLines,
		}
	} else {
		return {
			userRejected: false,
			result: `Command is still running in the user's terminal.${
				result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
			}\n\nYou will be updated on the terminal status and new output in the future.`,
			completed: false,
			outputLines,
		}
	}
}

/**
 * Helper to find last index matching a predicate
 */
export function findLastIndex<T>(array: T[], predicate: (item: T) => boolean): number {
	for (let i = array.length - 1; i >= 0; i--) {
		if (predicate(array[i])) {
			return i
		}
	}
	return -1
}
