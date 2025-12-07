import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { Logger } from "@services/logging/Logger"
import { TerminalHangStage, telemetryService } from "@services/telemetry"
import { ClineToolResponseContent } from "@shared/messages"

import { ActiveBackgroundCommand, CommandExecutorCallbacks, CommandExecutorConfig, ICommandExecutor } from "../ICommandExecutor"
import { TerminalManager } from "./TerminalManager"

/**
 * VSCode-specific configuration for command executor
 */
export interface VscodeCommandExecutorConfig extends CommandExecutorConfig {
	terminalManager: TerminalManager
}

// Chunked terminal output buffering constants
const CHUNK_LINE_COUNT = 20
const CHUNK_BYTE_SIZE = 2048 // 2KB
const CHUNK_DEBOUNCE_MS = 100
const BUFFER_STUCK_TIMEOUT_MS = 6000 // 6 seconds
const COMPLETION_TIMEOUT_MS = 6000 // 6 seconds

/**
 * VscodeCommandExecutor - VSCode Terminal Mode
 *
 * Handles command execution using VSCode's integrated terminal with shell integration.
 * This executor:
 * - Uses VSCode's terminal API for command execution
 * - Streams output to the chat UI in real-time
 * - Waits for commands to complete (blocking)
 * - Does NOT support "Proceed While Running" background tracking
 *
 * NOTE: Subagent commands are routed to BackgroundCommandExecutor at the factory level
 * (CommandExecutor.ts), so this executor only handles regular user commands.
 *
 * Used when terminalExecutionMode === "vscodeTerminal"
 */
export class VscodeCommandExecutor implements ICommandExecutor {
	private terminalManager: TerminalManager
	private cwd: string
	private ulid: string
	private callbacks: CommandExecutorCallbacks

	constructor(config: VscodeCommandExecutorConfig, callbacks: CommandExecutorCallbacks) {
		this.terminalManager = config.terminalManager
		this.cwd = config.cwd
		this.ulid = config.ulid
		this.callbacks = callbacks
	}

	/**
	 * Execute a command in the VSCode terminal
	 *
	 * NOTE: Command preprocessing (subagent detection, cd stripping) is handled
	 * at the CommandExecutor factory level before reaching this method.
	 *
	 * @param command The command to execute (already preprocessed)
	 * @param timeoutSeconds Optional timeout in seconds (not used in VSCode mode - commands run to completion)
	 * @returns [userRejected, result] tuple
	 */
	async execute(command: string, timeoutSeconds: number | undefined): Promise<[boolean, ClineToolResponseContent]> {
		Logger.info("Executing command in VSCode terminal: " + command)

		const terminalInfo = await this.terminalManager.getOrCreateTerminal(this.cwd)
		terminalInfo.terminal.show()
		const process = this.terminalManager.runCommand(terminalInfo, command)

		// Track command execution
		this.callbacks.updateBackgroundCommandState(true)

		const clearCommandState = async () => {
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
		}

		const scheduleFlush = () => {
			if (chunkTimer) {
				clearTimeout(chunkTimer)
			}
			chunkTimer = setTimeout(async () => await flushBuffer(), CHUNK_DEBOUNCE_MS)
		}

		const outputLines: string[] = []
		process.on("line", async (line) => {
			outputLines.push(line)

			// Apply buffered streaming
			outputBuffer.push(line)
			outputBufferSize += Buffer.byteLength(line, "utf8")
			// Flush if buffer is large enough
			if (outputBuffer.length >= CHUNK_LINE_COUNT || outputBufferSize >= CHUNK_BYTE_SIZE) {
				await flushBuffer()
			} else {
				scheduleFlush()
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
			if (outputBuffer.length > 0) {
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

		// In VSCode mode, we always wait for the command to complete
		await process

		// Clear timer if process completes normally
		if (completionTimer) {
			clearTimeout(completionTimer)
			completionTimer = null
		}

		// Wait for a short delay to ensure all messages are sent to the webview
		await setTimeoutPromise(50)

		const result = this.terminalManager.processOutput(outputLines)

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
	 * Cancel background command - NOT supported in VSCode mode
	 * VSCode terminal commands run to completion and cannot be cancelled via this interface.
	 */
	async cancelBackgroundCommand(): Promise<boolean> {
		// VSCode mode doesn't support background command cancellation
		return false
	}

	/**
	 * Check if there's an active background command - always false in VSCode mode
	 */
	hasActiveBackgroundCommand(): boolean {
		return false
	}

	/**
	 * Get the active background command info - always undefined in VSCode mode
	 */
	getActiveBackgroundCommand(): ActiveBackgroundCommand | undefined {
		return undefined
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
