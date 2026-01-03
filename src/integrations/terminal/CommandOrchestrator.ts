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
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
	BUFFER_STUCK_TIMEOUT_MS,
	CHUNK_BYTE_SIZE,
	CHUNK_DEBOUNCE_MS,
	CHUNK_LINE_COUNT,
	COMPLETION_TIMEOUT_MS,
	MAX_BYTES_BEFORE_FILE,
	MAX_LINES_BEFORE_FILE,
	SUMMARY_LINES_TO_KEEP,
} from "./constants"
import type {
	CommandExecutorCallbacks,
	ITerminalManager,
	OrchestrationOptions,
	OrchestrationResult,
	TerminalProcessResultPromise,
} from "./types"

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
	const {
		timeoutSeconds,
		onOutputLine,
		showShellIntegrationSuggestion,
		onProceedWhileRunning,
		terminalType = "vscode",
	} = options

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
	let backgroundTrackingResult: OrchestrationResult | null = null // Set when background tracking returns early

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
				telemetryService.captureTerminalHang(TerminalHangStage.BUFFER_STUCK, terminalType)
				bufferStuckTimer = null
			}, BUFFER_STUCK_TIMEOUT_MS)

			try {
				// Use ask() to present output and wait for user response
				// This enables "Proceed While Running" button functionality
				const { response, text, images, files } = await callbacks.ask("command_output", chunk)

				if (response === "yesButtonClicked") {
					// Track when user clicks "Proceed While Running"
					telemetryService.captureTerminalUserIntervention(
						TerminalUserInterventionAction.PROCESS_WHILE_RUNNING,
						terminalType,
					)
					// Proceed while running - but still capture user feedback if provided
					if (text || (images && images.length > 0) || (files && files.length > 0)) {
						userFeedback = { text, images, files }
					}
					didContinue = true

					// Notify caller to start background command tracking
					// Pass existing output lines so they can be written to the log file
					// and send log file path to UI if tracking was started
					if (onProceedWhileRunning) {
						const trackingResult = onProceedWhileRunning(outputLines)

						// Clear timers first
						if (chunkTimer) {
							clearTimeout(chunkTimer)
							chunkTimer = null
						}
						if (completionTimer) {
							clearTimeout(completionTimer)
							completionTimer = null
						}

						// Set early return result BEFORE resuming the process
						// This prevents the orchestrator's listener from processing new lines
						const result = terminalManager.processOutput(outputLines)
						const logMsg = trackingResult?.logFilePath ? `Log file: ${trackingResult.logFilePath}\n` : ""
						const outputMsg = result.length > 0 ? `Output so far:\n${result}` : ""

						backgroundTrackingResult = {
							userRejected: false,
							result: `Command is running in the background. You can proceed with other tasks.\n${logMsg}${outputMsg}`,
							completed: false,
							outputLines,
						}

						// Send log file message to UI BEFORE resuming the process
						// This ensures the message appears before any new output lines
						if (trackingResult?.logFilePath) {
							await callbacks.say("command_output", `\n📋 Output is being logged to: ${trackingResult.logFilePath}`)
						}

						// Now resume the process - any new lines will be handled by the background tracker
						process.continue()
						return
					}

					process.continue()
				} else if (response === "noButtonClicked" && text === COMMAND_CANCEL_TOKEN) {
					telemetryService.captureTerminalUserIntervention(TerminalUserInterventionAction.CANCELLED, terminalType)
					// Set flags BEFORE resuming the process to prevent new lines from being processed
					didCancelViaUi = true
					userFeedback = undefined
					didContinue = true
					outputBuffer = []
					outputBufferSize = 0
					// Send cancellation message BEFORE resuming the process
					// This ensures the message appears before any new output lines
					await callbacks.say("command_output", "Command cancelled")
					// Now resume the process
					process.continue()
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

	// Large output file-based logging state
	let isWritingToFile = false
	let largeOutputLogPath: string | null = null
	let largeOutputLogStream: fs.WriteStream | null = null
	let totalOutputBytes = 0
	let totalLineCount = 0
	let firstLines: string[] = [] // Keep first N lines for summary
	let lastLines: string[] = [] // Keep last N lines for summary (circular buffer)

	/**
	 * Switch to file-based logging when output is too large.
	 * This protects against memory exhaustion from commands with huge output.
	 */
	const switchToFileBased = async () => {
		if (isWritingToFile) return

		isWritingToFile = true

		// FIRST: Flush any pending buffer to UI so the "writing to file" message appears at the end
		if (outputBuffer.length > 0) {
			const chunk = outputBuffer.join("\n")
			outputBuffer = []
			outputBufferSize = 0
			if (!didContinue) {
				// Use say() instead of ask() since we're transitioning to file mode
				await callbacks.say("command_output", chunk)
			}
		}

		// Clear any pending flush timer
		if (chunkTimer) {
			clearTimeout(chunkTimer)
			chunkTimer = null
		}

		// Set up file logging
		largeOutputLogPath = path.join(os.tmpdir(), `cline-large-output-${Date.now()}.log`)
		largeOutputLogStream = fs.createWriteStream(largeOutputLogPath, { flags: "a" })

		// Write all existing lines to file in a single batch to reduce I/O overhead
		if (outputLines.length > 0) {
			largeOutputLogStream.write(outputLines.join("\n") + "\n")
		}

		// Keep first N lines for summary
		firstLines = outputLines.slice(0, SUMMARY_LINES_TO_KEEP)

		// Keep last N lines for summary (will be updated as more lines come in)
		lastLines = outputLines.slice(-SUMMARY_LINES_TO_KEEP)

		// FINALLY: Notify user (now this will appear at the end after all buffered output)
		await callbacks.say(
			"command_output",
			`\n📋 Output is large (${outputLines.length} lines, ${Math.round(totalOutputBytes / 1024)}KB). Writing to: ${largeOutputLogPath}`,
		)
	}

	/**
	 * Clean up file-based logging resources.
	 */
	const cleanupFileBased = () => {
		if (largeOutputLogStream) {
			largeOutputLogStream.end()
			largeOutputLogStream = null
		}
	}

	const outputLines: string[] = []
	process.on("line", async (line: string) => {
		if (didCancelViaUi) {
			return
		}

		// If background tracking is active, don't process lines here
		// The background tracker's listener will handle them
		if (backgroundTrackingResult) {
			return
		}

		const lineBytes = Buffer.byteLength(line, "utf8")
		totalOutputBytes += lineBytes
		totalLineCount++

		// Check if we should switch to file-based logging
		if (!isWritingToFile && (outputLines.length >= MAX_LINES_BEFORE_FILE || totalOutputBytes >= MAX_BYTES_BEFORE_FILE)) {
			await switchToFileBased()
		}

		if (isWritingToFile) {
			// Write to file instead of keeping in memory
			if (largeOutputLogStream) {
				largeOutputLogStream.write(line + "\n")
			}

			// Update last lines circular buffer for summary
			lastLines.push(line)
			if (lastLines.length > SUMMARY_LINES_TO_KEEP) {
				lastLines.shift()
			}
		} else {
			// Normal behavior - keep in memory
			outputLines.push(line)
		}

		// Notify caller about output line (for background command tracking)
		if (onOutputLine) {
			onOutputLine(line)
		}

		// Apply buffered streaming (only if not in file mode or still showing initial output)
		if (!didContinue) {
			if (!isWritingToFile) {
				outputBuffer.push(line)
				outputBufferSize += lineBytes
				// Flush if buffer is large enough
				if (outputBuffer.length >= CHUNK_LINE_COUNT || outputBufferSize >= CHUNK_BYTE_SIZE) {
					await flushBuffer()
				} else {
					scheduleFlush()
				}
			}
			// When in file mode, we've already notified the user, so don't keep buffering
		} else {
			// After "Proceed While Running" (without background tracking): stream output directly to UI
			// But throttle if we're in file mode to avoid flooding UI
			if (!isWritingToFile) {
				await callbacks.say("command_output", line)
			}
		}
	})

	let completed = false
	let completionTimer: NodeJS.Timeout | null = null

	// Start timer to detect if waiting for completion takes too long
	completionTimer = setTimeout(() => {
		if (!completed) {
			telemetryService.captureTerminalHang(TerminalHangStage.WAITING_FOR_COMPLETION, terminalType)
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

					// Clear all our timers first
					if (chunkTimer) {
						clearTimeout(chunkTimer)
						chunkTimer = null
					}
					if (completionTimer) {
						clearTimeout(completionTimer)
						completionTimer = null
					}

					// If background tracking is available (standalone mode only), use it
					// This writes output to a log file and detaches the command
					if (onProceedWhileRunning) {
						const trackingResult = onProceedWhileRunning(outputLines)

						// Set early return result BEFORE resuming the process
						// This prevents the orchestrator's listener from processing new lines
						const result = terminalManager.processOutput(outputLines)
						const logMsg = trackingResult?.logFilePath ? `Log file: ${trackingResult.logFilePath}\n` : ""
						const outputMsg = result.length > 0 ? `Output so far:\n${result}` : ""

						backgroundTrackingResult = {
							userRejected: false,
							result: `Command timed out after ${timeoutSeconds} seconds. Running in background.\n${logMsg}${outputMsg}`,
							completed: false,
							outputLines,
						}

						// Send log file message to UI BEFORE resuming the process
						if (trackingResult?.logFilePath) {
							await callbacks.say(
								"command_output",
								`\n⏱️ Command timed out. Output is being logged to: ${trackingResult.logFilePath}`,
							)
						}

						// Now resume the process - any new lines will be handled by the background tracker
						process.continue()
						// Clean up file-based logging if active before returning
						cleanupFileBased()
						return backgroundTrackingResult
					}

					// VSCode terminal mode: no background tracking available
					// Just continue the process and return timeout result
					process.continue()

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

	// Check if we returned early due to background tracking
	// This happens when user clicks "Proceed While Running" with background tracking enabled
	if (backgroundTrackingResult) {
		// Clean up file-based logging if active before returning
		cleanupFileBased()
		return backgroundTrackingResult
	}

	// Clear timer if process completes normally
	if (completionTimer) {
		clearTimeout(completionTimer)
		completionTimer = null
	}

	// Wait for a short delay to ensure all messages are sent to the webview
	await setTimeoutPromise(50)

	// Clean up file-based logging if active
	cleanupFileBased()

	// Build result based on whether we used file-based logging
	let result: string
	let resultOutputLines: string[]

	if (isWritingToFile) {
		// Build summary from first and last lines
		const skippedLines = totalLineCount - firstLines.length - lastLines.length
		const summaryLines = [...firstLines, `\n... (${skippedLines} lines written to ${largeOutputLogPath}) ...\n`, ...lastLines]
		result = terminalManager.processOutput(summaryLines)
		resultOutputLines = summaryLines
	} else {
		result = terminalManager.processOutput(outputLines)
		resultOutputLines = outputLines
	}

	if (didCancelViaUi) {
		return {
			userRejected: true,
			result: formatResponse.toolResult(
				`Command cancelled. ${result.length > 0 ? `\nOutput captured before cancellation:\n${result}` : ""}`,
			),
			completed: false,
			outputLines: resultOutputLines,
			logFilePath: largeOutputLogPath || undefined,
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
			outputLines: resultOutputLines,
			logFilePath: largeOutputLogPath || undefined,
		}
	}

	if (completed) {
		const logFileMsg = largeOutputLogPath ? `\nFull output saved to: ${largeOutputLogPath}` : ""
		return {
			userRejected: false,
			result: `Command executed.${result.length > 0 ? `\nOutput:\n${result}` : ""}${logFileMsg}`,
			completed: true,
			outputLines: resultOutputLines,
			logFilePath: largeOutputLogPath || undefined,
		}
	} else {
		const logFileMsg = largeOutputLogPath ? `\nFull output saved to: ${largeOutputLogPath}` : ""
		return {
			userRejected: false,
			result: `Command is still running in the user's terminal.${
				result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
			}${logFileMsg}\n\nYou will be updated on the terminal status and new output in the future.`,
			completed: false,
			outputLines: resultOutputLines,
			logFilePath: largeOutputLogPath || undefined,
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
