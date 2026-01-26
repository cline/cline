/**
 * ConcurrentCommandOrchestrator - Orchestration for parallel command execution.
 *
 * Unlike CommandOrchestrator which is designed for single commands,
 * this orchestrator handles multiple commands running in parallel without
 * calling ask() for each one (which would cause conflicts when parallel commands
 * try to ask at the same time).
 *
 * Key differences from CommandOrchestrator:
 * - Does NOT call ask() - output is delivered via say() directly
 * - Buffers output and streams it after command completion
 * - No "Proceed While Running" button (not needed for parallel execution)
 * - Handles concurrent output from multiple commands safely
 */

import { Logger } from "@services/logging/Logger"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
	CHUNK_BYTE_SIZE,
	CHUNK_DEBOUNCE_MS,
	CHUNK_LINE_COUNT,
	COMPLETION_TIMEOUT_MS,
	MAX_BYTES_BEFORE_FILE,
	MAX_LINES_BEFORE_FILE,
} from "./constants"
import type {
	CommandExecutorCallbacks,
	ITerminalManager,
	OrchestrationOptions,
	OrchestrationResult,
	TerminalProcessResultPromise,
} from "./types"

/**
 * Orchestrate concurrent command execution without interactive asks.
 * Multiple commands can run in parallel without trying to ask for each one's output.
 */
export async function orchestrateConcurrentCommandExecution(
	process: TerminalProcessResultPromise,
	terminalManager: ITerminalManager,
	callbacks: CommandExecutorCallbacks,
	options: OrchestrationOptions,
): Promise<OrchestrationResult> {
	const { timeoutSeconds, onOutputLine, terminalType = "vscode" } = options

	// Track command execution state
	callbacks.updateBackgroundCommandState(true)

	const clearCommandState = async () => {
		callbacks.updateBackgroundCommandState(false)

		// Mark the command message as completed
		const clineMessages = callbacks.getClineMessages()
		const findLastIndex = (arr: any[], predicate: (item: any) => boolean) => {
			for (let i = arr.length - 1; i >= 0; i--) {
				if (predicate(arr[i])) return i
			}
			return -1
		}
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

	// Accumulated output lines
	const outputLines: string[] = []
	let outputBuffer: string[] = []
	let outputBufferSize: number = 0
	let chunkTimer: NodeJS.Timeout | null = null
	let completionTimer: NodeJS.Timeout | null = null

	// Large output file-based logging state
	let isWritingToFile = false
	let largeOutputLogPath: string | null = null
	let largeOutputLogStream: fs.WriteStream | null = null
	let totalOutputBytes = 0
	let totalLineCount = 0

	const scheduleFlush = () => {
		if (chunkTimer) {
			clearTimeout(chunkTimer)
		}
		chunkTimer = setTimeout(async () => await flushBuffer(), CHUNK_DEBOUNCE_MS)
	}

	const flushBuffer = async (force = false) => {
		if (outputBuffer.length === 0 && !force) {
			return
		}

		const chunk = outputBuffer.join("\n")
		outputBuffer = []
		outputBufferSize = 0

		if (chunk) {
			// In concurrent mode, we use say() directly without ask()
			// This avoids conflicts when multiple commands output simultaneously
			await callbacks.say("command_output", chunk)
		}
	}

	const switchToFileBased = async () => {
		if (isWritingToFile) return

		isWritingToFile = true

		// Flush any pending buffer to UI
		if (outputBuffer.length > 0) {
			const chunk = outputBuffer.join("\n")
			outputBuffer = []
			outputBufferSize = 0
			await callbacks.say("command_output", chunk)
		}

		// Clear any pending flush timer
		if (chunkTimer) {
			clearTimeout(chunkTimer)
			chunkTimer = null
		}

		// Set up file logging
		largeOutputLogPath = path.join(os.tmpdir(), `cline-large-output-${Date.now()}.log`)
		largeOutputLogStream = fs.createWriteStream(largeOutputLogPath, { flags: "a" })

		// Write all existing lines to file
		if (outputLines.length > 0) {
			largeOutputLogStream.write(outputLines.join("\n") + "\n")
		}

		// Notify user
		await callbacks.say(
			"command_output",
			`\n📋 Output is large (${outputLines.length} lines, ${Math.round(totalOutputBytes / 1024)}KB). Writing to: ${largeOutputLogPath}`,
		)
	}

	const processLine = async (line: string) => {
		outputLines.push(line)
		totalLineCount++
		totalOutputBytes += line.length + 1

		// Check if we need to switch to file-based logging
		if (totalLineCount > MAX_LINES_BEFORE_FILE || totalOutputBytes > MAX_BYTES_BEFORE_FILE) {
			await switchToFileBased()
		}

		// If file-based logging is enabled, write to file
		if (isWritingToFile && largeOutputLogStream) {
			largeOutputLogStream.write(line + "\n")
		} else {
			// Otherwise buffer for UI delivery
			outputBuffer.push(line)
			outputBufferSize += line.length + 1

			// Flush when buffer is full
			if (outputBuffer.length >= CHUNK_LINE_COUNT || outputBufferSize >= CHUNK_BYTE_SIZE) {
				if (chunkTimer) {
					clearTimeout(chunkTimer)
					chunkTimer = null
				}
				await flushBuffer()
			} else {
				scheduleFlush()
			}
		}

		// Call the line output handler if provided
		if (onOutputLine) {
			onOutputLine(line)
		}
	}

	const completionHandler = async () => {
		// Clear timers
		if (chunkTimer) {
			clearTimeout(chunkTimer)
			chunkTimer = null
		}
		if (completionTimer) {
			clearTimeout(completionTimer)
			completionTimer = null
		}

		// Final flush
		await flushBuffer(true)

		// Close file stream if open
		if (largeOutputLogStream) {
			largeOutputLogStream.end()
			largeOutputLogStream = null
		}
	}

	// Set up completion timeout
	completionTimer = setTimeout(async () => {
		await completionHandler()
	}, COMPLETION_TIMEOUT_MS)

	try {
		// Listen for output lines
		process.on("line", async (line: string) => {
			await processLine(line)
		})

		// Wait for process to complete
		const result = await process

		await completionHandler()

		// Process final output
		const terminalOutput = terminalManager.processOutput(outputLines)

		return {
			userRejected: false,
			result: terminalOutput,
			completed: true,
			outputLines,
		}
	} catch (error) {
		await completionHandler()

		if (error instanceof Error) {
			Logger.error(`Concurrent command execution error: ${error.message}`)
			if (largeOutputLogPath) {
				return {
					userRejected: false,
					result: `Error: ${error.message}\n\nOutput was logged to: ${largeOutputLogPath}`,
					completed: true,
					outputLines,
				}
			}
			return {
				userRejected: false,
				result: `Error: ${error.message}`,
				completed: true,
				outputLines,
			}
		}

		return {
			userRejected: false,
			result: "Unknown error occurred",
			completed: true,
			outputLines,
		}
	}
}
