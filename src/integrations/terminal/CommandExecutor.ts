/**
 * CommandExecutor - Unified command execution for the standalone runtime.
 *
 * This class uses the shared CommandOrchestrator for buffering, user interaction,
 * background tracking, and result formatting while delegating process execution to
 * StandaloneTerminalManager.
 */

import { findLastIndex } from "@shared/array"
import { ClineToolResponseContent } from "@shared/messages"
import { Logger } from "@/shared/services/Logger"
import { orchestrateCommandExecution } from "./CommandOrchestrator"
import { StandaloneTerminalManager } from "./standalone/StandaloneTerminalManager"
import type {
	CommandExecutionOptions,
	CommandExecutorCallbacks,
	CommandExecutorConfig,
	TerminalProcessResultPromise,
} from "./types"

/** Command executor for the unified standalone terminal runtime. */
export class CommandExecutor {
	private cwd: string
	private taskId: string
	private ulid: string
	private terminalManager: StandaloneTerminalManager
	private callbacks: CommandExecutorCallbacks

	// Track the currently executing foreground process for cancellation
	private currentProcess: TerminalProcessResultPromise | null = null

	// Flag to track if the current command was cancelled externally
	private wasCancelledExternally = false

	constructor(config: CommandExecutorConfig, callbacks: CommandExecutorCallbacks) {
		this.cwd = config.cwd
		this.taskId = config.taskId
		this.ulid = config.ulid
		this.callbacks = callbacks

		if (config.terminalManager instanceof StandaloneTerminalManager) {
			this.terminalManager = config.terminalManager
			Logger.info("[CommandExecutor] Reusing Task's StandaloneTerminalManager")
		} else {
			this.terminalManager = new StandaloneTerminalManager()
			Logger.warn("[CommandExecutor] Received non-standalone terminal manager; falling back to StandaloneTerminalManager")

			if ("terminalReuseEnabled" in (config.terminalManager as any)) {
				const tm = config.terminalManager as any
				this.terminalManager.setTerminalReuseEnabled(tm.terminalReuseEnabled ?? true)
				this.terminalManager.setTerminalOutputLineLimit(tm.terminalOutputLineLimit || 500)
			}
		}
	}

	/**
	 * Execute a command in the terminal.
	 *
	 * Routing logic:
	 * 1. Background mode commands use StandaloneTerminalManager
	 * 2. Regular commands use the configured terminal manager
	 *
	 * @param command The command to execute
	 * @param timeoutSeconds Optional timeout in seconds
	 * @returns [userRejected, result] tuple
	 */
	async execute(
		command: string,
		timeoutSeconds: number | undefined,
		options?: CommandExecutionOptions,
	): Promise<[boolean, ClineToolResponseContent]> {
		// Strip leading `cd` to workspace from command
		const workspaceCdPrefix = `cd ${this.cwd} && `
		if (command.startsWith(workspaceCdPrefix)) {
			command = command.substring(workspaceCdPrefix.length)
		}

		if (options?.useBackgroundExecution) {
			Logger.debug(
				"[CommandExecutor] useBackgroundExecution is now a no-op because all commands use the standalone runtime",
			)
		}

		const manager = this.terminalManager
		Logger.info(`Executing command in standalone terminal: ${command}`)

		// Get terminal and run command
		const terminalInfo = await manager.getOrCreateTerminal(this.cwd)
		terminalInfo.terminal.show()
		const process = manager.runCommand(terminalInfo, command)

		// Reset cancellation flag and track the current process
		this.wasCancelledExternally = false
		this.currentProcess = process
		const clearCurrentProcess = () => {
			this.currentProcess = null
		}
		process.once("completed", clearCurrentProcess)
		process.once("error", clearCurrentProcess)

		const result = await orchestrateCommandExecution(process, manager, this.callbacks, {
			command,
			timeoutSeconds,
			suppressUserInteraction: options?.suppressUserInteraction,
			onProceedWhileRunning: (existingOutput: string[]) => {
				const backgroundCmd = this.terminalManager.trackBackgroundCommand(process, command, existingOutput)
				return { logFilePath: backgroundCmd.logFilePath }
			},
			terminalType: "standalone",
		})

		// If the command was cancelled externally (via cancel button), return a clear cancellation message
		// This ensures the AI agent knows the command was cancelled by the user
		if (this.wasCancelledExternally) {
			const outputSoFar =
				result.outputLines.length > 0
					? `\nOutput captured before cancellation:\n${manager.processOutput(result.outputLines)}`
					: ""
			return [true, `Command was cancelled by the user.${outputSoFar}`]
		}

		return [result.userRejected, result.result]
	}

	/**
	 * Cancel all running commands (both foreground and background).
	 *
	 * This method cancels:
	 * 1. All detached background commands (those that were "proceeded while running")
	 * 2. The current foreground process (if one is actively running)
	 *
	 * @returns true if any commands were cancelled, false otherwise
	 */
	async cancelBackgroundCommand(): Promise<boolean> {
		let cancelled = false

		// 1. Cancel all detached background commands
		const runningCommands = this.terminalManager.getRunningBackgroundCommands()
		for (const cmd of runningCommands) {
			if (this.terminalManager.cancelBackgroundCommand(cmd.id)) {
				cancelled = true
				Logger.info(`Cancelled background command: ${cmd.command}`)
			}
		}

		// 2. Cancel the current foreground process (if any)
		if (this.currentProcess && typeof (this.currentProcess as any).terminate === "function") {
			// Set flag so execute() knows the command was cancelled externally
			this.wasCancelledExternally = true
			;(this.currentProcess as any).terminate()
			this.currentProcess = null
			cancelled = true
			Logger.info("Cancelled foreground command")
		}

		// 3. Update UI state and notify user by modifying existing message
		// We modify the previous command_output message instead of sending a new say()
		// to avoid interfering with any pending ask() dialogs (which would cause
		// "Current ask promise was ignored" errors)
		if (cancelled) {
			this.callbacks.updateBackgroundCommandState(false)

			// Wait for terminal buffers to flush before updating the message
			// This prevents the cancellation notice from appearing in the middle of output
			await new Promise((resolve) => setTimeout(resolve, 300))

			// Find the last command_output message and update it
			const messages = this.callbacks.getClineMessages()
			const lastCommandOutputIndex = findLastIndex(messages, (m) => m.ask === "command_output")
			if (lastCommandOutputIndex !== -1) {
				const existingText = messages[lastCommandOutputIndex].text || ""
				const cancellationNotice = "\n\nCommand(s) cancelled by user."
				await this.callbacks.updateClineMessage(lastCommandOutputIndex, {
					text: existingText + cancellationNotice,
				})
			}
		}

		return cancelled
	}

	/**
	 * Check if there are any active background commands.
	 */
	hasActiveBackgroundCommand(): boolean {
		return this.terminalManager.hasActiveBackgroundCommands()
	}

	/**
	 * Get a summary of background commands for environment details.
	 */
	getBackgroundCommandSummary(): string | undefined {
		const summary = this.terminalManager.getBackgroundCommandsSummary()
		return summary || undefined
	}
}
