import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { formatResponse } from "@core/prompts/responses"
import { isSubagentCommand, transformClineCommand } from "@integrations/cli-subagents/subagent_command"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { Logger } from "@services/logging/Logger"
import { TerminalHangStage, telemetryService } from "@services/telemetry"
import { ClineToolResponseContent } from "@shared/messages"

import { BackgroundCommandTracker } from "./BackgroundCommandTracker"
import { TerminalManager } from "./vscode/TerminalManager"
import { TerminalProcessResultPromise } from "./vscode/TerminalProcess"

/**
 * Callbacks for CommandExecutor to interact with Task state
 * These are bound methods from the Task class that allow CommandExecutor
 * to update UI and state without owning that state directly.
 */
export interface CommandExecutorCallbacks {
	/** Display a message in the chat UI */
	say: (type: string, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>
	/** Update the background command running state in the controller */
	updateBackgroundCommandState: (running: boolean) => void
	/** Update a cline message by index */
	updateClineMessage: (index: number, updates: { commandCompleted?: boolean }) => Promise<void>
	/** Get cline messages array */
	getClineMessages: () => Array<{ ask?: string; say?: string }>
	/** Add content to user message for next API request */
	addToUserMessageContent: (content: { type: string; text: string }) => void
	/** Get the current ask response state */
	getAskResponse: () => string | undefined
	/** Clear the ask response state */
	clearAskResponse: () => void
}

/**
 * Configuration for CommandExecutor
 */
export interface CommandExecutorConfig {
	terminalManager: TerminalManager
	backgroundCommandTracker: BackgroundCommandTracker | undefined
	terminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	cwd: string
	taskId: string
	ulid: string
	standaloneTerminalModulePath: string
}

// Default timeout for commands in yolo mode and background exec mode
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 30

// Chunked terminal output buffering constants
const CHUNK_LINE_COUNT = 20
const CHUNK_BYTE_SIZE = 2048 // 2KB
const CHUNK_DEBOUNCE_MS = 100
const BUFFER_STUCK_TIMEOUT_MS = 6000 // 6 seconds
const COMPLETION_TIMEOUT_MS = 6000 // 6 seconds

/**
 * CommandExecutor handles the execution of shell commands in terminals.
 * It manages terminal lifecycle, output streaming, and "Proceed While Running" functionality.
 *
 * This class is extracted from Task to improve separation of concerns.
 * It uses callbacks to interact with Task state rather than owning that state directly.
 */
export class CommandExecutor {
	private terminalManager: TerminalManager
	private backgroundCommandTracker: BackgroundCommandTracker | undefined
	private terminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	private cwd: string
	private taskId: string
	private ulid: string
	private standaloneTerminalModulePath: string
	private callbacks: CommandExecutorCallbacks

	// Track active background command for cancellation
	private activeBackgroundCommand?: {
		process: TerminalProcessResultPromise & {
			terminate?: () => void
		}
		command: string
		outputLines: string[]
	}

	constructor(config: CommandExecutorConfig, callbacks: CommandExecutorCallbacks) {
		this.terminalManager = config.terminalManager
		this.backgroundCommandTracker = config.backgroundCommandTracker
		this.terminalExecutionMode = config.terminalExecutionMode
		this.cwd = config.cwd
		this.taskId = config.taskId
		this.ulid = config.ulid
		this.standaloneTerminalModulePath = config.standaloneTerminalModulePath
		this.callbacks = callbacks
	}

	/**
	 * Execute a command in the terminal
	 * @param command The command to execute
	 * @param timeoutSeconds Optional timeout in seconds
	 * @returns [userRejected, result] tuple
	 */
	async execute(command: string, timeoutSeconds: number | undefined): Promise<[boolean, ClineToolResponseContent]> {
		// For Cline CLI subagents, we want to parse and process the command to ensure flags are correct
		const isSubagent = isSubagentCommand(command)

		if (transformClineCommand(command) !== command && isSubagent) {
			command = transformClineCommand(command)
		}

		// Strip leading `cd` to workspace from command
		const workspaceCdPrefix = `cd ${this.cwd} && `
		if (command.startsWith(workspaceCdPrefix)) {
			command = command.substring(workspaceCdPrefix.length)
		}

		const subAgentStartTime = isSubagent ? performance.now() : 0

		Logger.info("Executing command in terminal: " + command)

		let terminalManager: TerminalManager
		if (isSubagent) {
			// Create a background TerminalManager for CLI subagents
			try {
				const { StandaloneTerminalManager } = require(this.standaloneTerminalModulePath) as {
					StandaloneTerminalManager?: new () => TerminalManager
				}
				if (StandaloneTerminalManager) {
					terminalManager = new StandaloneTerminalManager()
				} else {
					terminalManager = new TerminalManager()
				}
			} catch (error) {
				console.error("[DEBUG] Failed to load standalone terminal manager for subagent", error)
				terminalManager = new TerminalManager()
			}
			terminalManager.setShellIntegrationTimeout(this.terminalManager["shellIntegrationTimeout"] || 4000)
			terminalManager.setTerminalReuseEnabled(this.terminalManager["terminalReuseEnabled"] ?? true)
			terminalManager.setTerminalOutputLineLimit(this.terminalManager["terminalOutputLineLimit"] || 500)
			terminalManager.setSubagentTerminalOutputLineLimit(this.terminalManager["subagentTerminalOutputLineLimit"] || 2000)
		} else {
			// Use the configured terminal manager for regular commands
			terminalManager = this.terminalManager
		}

		const terminalInfo = await terminalManager.getOrCreateTerminal(this.cwd)
		terminalInfo.terminal.show()
		const process = terminalManager.runCommand(terminalInfo, command)

		// Track command execution for both terminal modes
		this.callbacks.updateBackgroundCommandState(true)

		if (this.terminalExecutionMode === "backgroundExec") {
			this.activeBackgroundCommand = { process: process as any, command, outputLines: [] }
		}

		const clearCommandState = async () => {
			if (this.terminalExecutionMode === "backgroundExec") {
				if (this.activeBackgroundCommand?.process !== process) {
					return
				}
				this.activeBackgroundCommand = undefined
			}
			this.callbacks.updateBackgroundCommandState(false)

			// Mark the command message as completed
			const clineMessages = this.callbacks.getClineMessages()
			const lastCommandIndex = this.findLastIndex(clineMessages, (m) => m.ask === "command" || m.say === "command")
			if (lastCommandIndex !== -1) {
				await this.callbacks.updateClineMessage(lastCommandIndex, {
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
		const didCancelViaUi = false

		// Create a promise that resolves when user clicks "Proceed While Running"
		let cleanupProceedCheck: (() => void) | undefined
		const proceedPromise = new Promise<"proceed">((resolve) => {
			// Note: This check is handled by the Task class through askResponse state
			// For now, we'll rely on the timeout/completion flow
			// The Task class will need to signal this through a callback if needed
			cleanupProceedCheck = () => {}
		})

		// Chunked terminal output buffering
		let outputBuffer: string[] = []
		let outputBufferSize: number = 0
		let chunkTimer: NodeJS.Timeout | null = null

		// Track if buffer gets stuck
		let bufferStuckTimer: NodeJS.Timeout | null = null

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

				// Use say() to stream output without blocking
				await this.callbacks.say("command_output", chunk)

				// Clear the stuck timer since we successfully sent output
				if (bufferStuckTimer) {
					clearTimeout(bufferStuckTimer)
					bufferStuckTimer = null
				}
			} else {
				// Already continuing - just stream output via say()
				await this.callbacks.say("command_output", chunk)
			}
		}

		const scheduleFlush = () => {
			if (chunkTimer) {
				clearTimeout(chunkTimer)
			}
			chunkTimer = setTimeout(async () => await flushBuffer(), CHUNK_DEBOUNCE_MS)
		}

		const outputLines: string[] = []
		process.on("line", async (line) => {
			if (didCancelViaUi) {
				return
			}
			outputLines.push(line)

			// Track output in activeBackgroundCommand for cancellation
			if (this.terminalExecutionMode === "backgroundExec" && this.activeBackgroundCommand) {
				this.activeBackgroundCommand.outputLines.push(line)
			}

			// Apply buffered streaming for both vscodeTerminal and backgroundExec modes
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
				// After "Proceed While Running":
				// - For backgroundExec mode: DON'T stream to UI
				if (this.terminalExecutionMode !== "backgroundExec") {
					this.callbacks.say("command_output", line)
				}
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
			await this.callbacks.say("shell_integration_warning")
		})

		if (!didCancelViaUi) {
			if (timeoutSeconds) {
				const timeoutPromise = new Promise<never>((_, reject) => {
					setTimeout(() => {
						reject(new Error("COMMAND_TIMEOUT"))
					}, timeoutSeconds * 1000)
				})

				try {
					// Race between: process completion, timeout, and user clicking "Proceed While Running"
					const raceResult = await Promise.race([
						process.then(() => "completed" as const),
						timeoutPromise,
						proceedPromise,
					])

					// Handle user clicking "Proceed While Running"
					if (raceResult === "proceed") {
						didContinue = true
						return await this.handleProceedWhileRunning(
							process,
							command,
							outputLines,
							cleanupProceedCheck,
							chunkTimer,
							completionTimer,
							terminalManager,
						)
					}
				} catch (error: any) {
					if (error.message === "COMMAND_TIMEOUT") {
						// Handle timeout the same way as "Proceed While Running"
						didContinue = true
						return await this.handleProceedWhileRunning(
							process,
							command,
							outputLines,
							cleanupProceedCheck,
							chunkTimer,
							completionTimer,
							terminalManager,
						)
					}
					throw error
				}
			} else {
				if (this.terminalExecutionMode !== "backgroundExec") {
					await process
				} else {
					const raceResult = await Promise.race([process.then(() => "completed" as const), proceedPromise])

					if (raceResult === "proceed") {
						didContinue = true
						return await this.handleProceedWhileRunning(
							process,
							command,
							outputLines,
							cleanupProceedCheck,
							chunkTimer,
							completionTimer,
							terminalManager,
						)
					}
				}
			}
		}

		// Cleanup the proceed check interval if still running
		if (cleanupProceedCheck) {
			cleanupProceedCheck()
		}

		// Clear timer if process completes normally
		if (completionTimer) {
			clearTimeout(completionTimer)
			completionTimer = null
		}

		// Wait for a short delay to ensure all messages are sent to the webview
		if (!didCancelViaUi) {
			await setTimeoutPromise(50)
		}

		const result = terminalManager.processOutput(
			outputLines,
			isSubagent ? terminalManager["subagentTerminalOutputLineLimit"] : undefined,
			isSubagent,
		)

		if (didCancelViaUi) {
			return [
				true,
				formatResponse.toolResult(
					`Command cancelled. ${result.length > 0 ? `\nOutput captured before cancellation:\n${result}` : ""}`,
				),
			]
		}

		// Capture subagent telemetry if this was a subagent command
		if (isSubagent && subAgentStartTime > 0) {
			const durationMs = Math.round(performance.now() - subAgentStartTime)
			telemetryService.captureSubagentExecution(this.ulid, durationMs, outputLines.length, completed)
		}

		if (userFeedback) {
			await this.callbacks.say("user_feedback", userFeedback.text, userFeedback.images, userFeedback.files)

			let fileContentString = ""
			if (userFeedback.files && userFeedback.files.length > 0) {
				fileContentString = await processFilesIntoText(userFeedback.files)
			}

			return [
				true,
				formatResponse.toolResult(
					`Command is still running in the user's terminal.${
						result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
					}\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
					userFeedback.images,
					fileContentString,
				),
			]
		}

		if (completed) {
			return [false, `Command executed.${result.length > 0 ? `\nOutput:\n${result}` : ""}`]
		} else {
			return [
				false,
				`Command is still running in the user's terminal.${
					result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
				}\n\nYou will be updated on the terminal status and new output in the future.`,
			]
		}
	}

	/**
	 * Helper method to handle "Proceed While Running" action.
	 * Extracts common logic for when user clicks proceed while a command is still running.
	 */
	private async handleProceedWhileRunning(
		process: TerminalProcessResultPromise,
		command: string,
		outputLines: string[],
		cleanupProceedCheck: (() => void) | undefined,
		chunkTimer: NodeJS.Timeout | null,
		completionTimer: NodeJS.Timeout | null,
		terminalManager: TerminalManager,
	): Promise<[boolean, string]> {
		let trackedCommand: { logFilePath: string } | undefined
		if (this.terminalExecutionMode === "backgroundExec" && this.backgroundCommandTracker) {
			trackedCommand = this.backgroundCommandTracker.trackCommand(process, command)
		}

		process.continue()

		// Cleanup timers
		if (cleanupProceedCheck) {
			cleanupProceedCheck()
		}
		if (chunkTimer) {
			clearTimeout(chunkTimer)
		}
		if (completionTimer) {
			clearTimeout(completionTimer)
		}

		// Send a message to the UI with the log file path (only in backgroundExec mode)
		if (this.terminalExecutionMode === "backgroundExec" && trackedCommand) {
			await this.callbacks.say("command_output", `\n📋 Output is being logged to: ${trackedCommand.logFilePath}`)
		}

		await setTimeoutPromise(50)
		const result = terminalManager.processOutput(outputLines, undefined, false)

		// Build response message
		const logMsg =
			this.terminalExecutionMode === "backgroundExec" && trackedCommand ? `Log file: ${trackedCommand.logFilePath}\n` : ""
		const outputMsg = result.length > 0 ? `Output so far:\n${result}` : ""

		return [false, `Command is running in the background. You can proceed with other tasks.\n${logMsg}${outputMsg}`]
	}

	/**
	 * Cancel the currently running background command
	 * @returns true if a command was cancelled, false otherwise
	 */
	async cancelBackgroundCommand(): Promise<boolean> {
		if (this.terminalExecutionMode !== "backgroundExec" || !this.activeBackgroundCommand) {
			return false
		}

		const { process, command, outputLines } = this.activeBackgroundCommand
		this.activeBackgroundCommand = undefined
		this.callbacks.updateBackgroundCommandState(false)

		try {
			// Try to terminate the process if the method exists
			if (typeof process.terminate === "function") {
				try {
					await process.terminate()
					Logger.info(`Terminated background command: ${command}`)
				} catch (error) {
					Logger.error(`Error terminating background command: ${command}`, error)
				}
			}

			// Ensure any pending operations complete
			if (typeof process.continue === "function") {
				try {
					process.continue()
				} catch (error) {
					Logger.error(`Error continuing background command: ${command}`, error)
				}
			}

			// Mark the command message as completed in the UI
			const clineMessages = this.callbacks.getClineMessages()
			const lastCommandIndex = this.findLastIndex(clineMessages, (m) => m.ask === "command" || m.say === "command")
			if (lastCommandIndex !== -1) {
				await this.callbacks.updateClineMessage(lastCommandIndex, {
					commandCompleted: true,
				})
			}

			// Process the captured output to include in the cancellation message
			const processedOutput = this.terminalManager.processOutput(outputLines, undefined, false)

			// Add cancellation information to the API conversation history
			let cancellationMessage = `Command "${command}" was cancelled by the user.`
			if (processedOutput.length > 0) {
				cancellationMessage += `\n\nOutput captured before cancellation:\n${processedOutput}`
			}

			this.callbacks.addToUserMessageContent({
				type: "text",
				text: cancellationMessage,
			})

			return true
		} catch (error) {
			Logger.error("Error in cancelBackgroundCommand", error)
			return false
		} finally {
			try {
				await this.callbacks.say("command_output", "Command execution has been cancelled.")
			} catch (error) {
				Logger.error("Failed to send cancellation notification", error)
			}
		}
	}

	/**
	 * Check if there's an active background command
	 */
	hasActiveBackgroundCommand(): boolean {
		return !!this.activeBackgroundCommand
	}

	/**
	 * Get the active background command info (for external access)
	 */
	getActiveBackgroundCommand() {
		return this.activeBackgroundCommand
	}

	/**
	 * Helper to find last index matching a predicate
	 */
	private findLastIndex<T>(array: T[], predicate: (item: T) => boolean): number {
		for (let i = array.length - 1; i >= 0; i--) {
			if (predicate(array[i])) {
				return i
			}
		}
		return -1
	}
}
