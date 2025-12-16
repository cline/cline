/**
 * CommandExecutor - Unified command execution for all terminal modes.
 *
 * This class handles command execution for both VSCode terminal mode and
 * standalone/CLI mode. It uses the shared CommandOrchestrator for the
 * common orchestration logic (buffering, user interaction, result formatting).
 *
 * The differentiation between modes happens at the TerminalManager level:
 * - VscodeTerminalManager → VscodeTerminalProcess (shell integration)
 * - StandaloneTerminalManager → StandaloneTerminalProcess (child_process)
 *
 * IMPORTANT: Subagent commands (cline CLI) are ALWAYS routed to use
 * StandaloneTerminalManager regardless of the configured mode. This ensures
 * subagents run in hidden/background terminals rather than cluttering the
 * user's visible VSCode terminal.
 */

import { isSubagentCommand, transformClineCommand } from "@integrations/cli-subagents/subagent_command"
import { Logger } from "@services/logging/Logger"
import { telemetryService } from "@services/telemetry"
import { ClineToolResponseContent } from "@shared/messages"
import { orchestrateCommandExecution } from "./CommandOrchestrator"
import { StandaloneTerminalManager } from "./standalone/StandaloneTerminalManager"
import {
	ActiveBackgroundCommand,
	CommandExecutorCallbacks,
	CommandExecutorConfig,
	ITerminalManager,
	TerminalProcessResultPromise,
} from "./types"

// Re-export types for convenience
export type { CommandExecutorCallbacks, CommandExecutorConfig, FullCommandExecutorConfig } from "./types"

/**
 * Tracker for shell integration warnings to determine when to show background terminal suggestion
 */
interface ShellIntegrationWarningTracker {
	timestamps: number[]
	lastSuggestionShown?: number
}

/**
 * CommandExecutor - Unified command executor for all terminal modes.
 *
 * Uses the shared CommandOrchestrator for common logic and delegates
 * process management to the appropriate TerminalManager.
 */
export class CommandExecutor {
	private cwd: string
	private taskId: string
	private ulid: string
	private terminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	private terminalManager: ITerminalManager
	private standaloneManager: StandaloneTerminalManager
	private callbacks: CommandExecutorCallbacks

	// Track shell integration warnings to determine when to show background terminal suggestion
	private shellIntegrationWarningTracker: ShellIntegrationWarningTracker = {
		timestamps: [],
		lastSuggestionShown: undefined,
	}

	// Track active background command for cancellation (standalone mode only)
	private activeBackgroundCommand?: {
		process: TerminalProcessResultPromise & { terminate?: () => void }
		command: string
		outputLines: string[]
	}

	constructor(config: CommandExecutorConfig, callbacks: CommandExecutorCallbacks) {
		this.cwd = config.cwd
		this.taskId = config.taskId
		this.ulid = config.ulid
		this.terminalExecutionMode = config.terminalExecutionMode
		this.terminalManager = config.terminalManager
		this.callbacks = callbacks

		// Always create StandaloneTerminalManager for subagents (even in VSCode mode)
		this.standaloneManager = new StandaloneTerminalManager()

		// Copy settings from the provided terminalManager to ensure consistency
		if ("shellIntegrationTimeout" in config.terminalManager) {
			const tm = config.terminalManager as any
			this.standaloneManager.setShellIntegrationTimeout(tm.shellIntegrationTimeout || 4000)
			this.standaloneManager.setTerminalReuseEnabled(tm.terminalReuseEnabled ?? true)
			this.standaloneManager.setTerminalOutputLineLimit(tm.terminalOutputLineLimit || 500)
			this.standaloneManager.setSubagentTerminalOutputLineLimit(tm.subagentTerminalOutputLineLimit || 2000)
		}
	}

	/**
	 * Execute a command in the terminal.
	 *
	 * Routing logic:
	 * 1. Subagent commands (cline CLI) → Always use StandaloneTerminalManager
	 *    This ensures subagents run in hidden terminals, not cluttering the user's VSCode terminal
	 * 2. Regular commands → Use the configured terminal manager based on terminalExecutionMode
	 *
	 * @param command The command to execute
	 * @param timeoutSeconds Optional timeout in seconds
	 * @returns [userRejected, result] tuple
	 */
	async execute(command: string, timeoutSeconds: number | undefined): Promise<[boolean, ClineToolResponseContent]> {
		// Transform subagent commands to ensure flags are correct
		const isSubagent = isSubagentCommand(command)
		if (isSubagent) {
			command = transformClineCommand(command)
		}

		// Strip leading `cd` to workspace from command
		const workspaceCdPrefix = `cd ${this.cwd} && `
		if (command.startsWith(workspaceCdPrefix)) {
			command = command.substring(workspaceCdPrefix.length)
		}

		const subAgentStartTime = isSubagent ? performance.now() : 0

		// Select the appropriate terminal manager
		// Subagents always use standalone manager (hidden terminal)
		const useStandalone = isSubagent || this.terminalExecutionMode === "backgroundExec"
		const manager = useStandalone ? this.standaloneManager : this.terminalManager

		Logger.info(`Executing command in ${useStandalone ? "standalone" : "VSCode"} terminal: ${command}`)

		// Get terminal and run command
		const terminalInfo = await manager.getOrCreateTerminal(this.cwd)
		terminalInfo.terminal.show()
		const process = manager.runCommand(terminalInfo, command)

		// Track background command for standalone mode (enables cancellation)
		if (useStandalone) {
			this.activeBackgroundCommand = {
				process: process as any,
				command,
				outputLines: [],
			}
		}

		// Use shared orchestration logic
		const result = await orchestrateCommandExecution(process, manager, this.callbacks, {
			command,
			timeoutSeconds,
			onOutputLine: useStandalone
				? (line) => {
						if (this.activeBackgroundCommand) {
							this.activeBackgroundCommand.outputLines.push(line)
						}
					}
				: undefined,
			showShellIntegrationSuggestion: this.shouldShowBackgroundTerminalSuggestion(),
		})

		// Clear background command tracking if completed
		if (result.completed && useStandalone) {
			this.activeBackgroundCommand = undefined
		}

		// Capture subagent telemetry
		if (isSubagent && subAgentStartTime > 0) {
			const durationMs = Math.round(performance.now() - subAgentStartTime)
			telemetryService.captureSubagentExecution(this.ulid, durationMs, result.outputLines.length, result.completed)
		}

		return [result.userRejected, result.result]
	}

	/**
	 * Cancel the currently running background command.
	 * Only works in standalone/backgroundExec mode.
	 *
	 * @returns true if a command was cancelled, false otherwise
	 */
	async cancelBackgroundCommand(): Promise<boolean> {
		if (!this.activeBackgroundCommand) {
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
			const processedOutput = this.standaloneManager.processOutput(outputLines, undefined, false)

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
	getActiveBackgroundCommand(): ActiveBackgroundCommand | undefined {
		return this.activeBackgroundCommand
	}

	/**
	 * Get a summary of background commands for environment details
	 */
	getBackgroundCommandSummary(): string | undefined {
		if (!this.activeBackgroundCommand) {
			return undefined
		}

		const { command, outputLines } = this.activeBackgroundCommand
		const recentOutput = outputLines.slice(-10).join("\n")

		let summary = "# Background Commands\n"
		summary += `## Running: \`${command}\`\n`
		if (recentOutput) {
			summary += `### Recent Output\n${recentOutput}`
		}

		return summary
	}

	/**
	 * Determines whether to show the background terminal suggestion.
	 * Shows suggestion if there have been 3+ shell integration warnings in the last hour,
	 * and we haven't shown the suggestion in the last hour.
	 *
	 * @returns true if the suggestion should be shown, false otherwise
	 */
	private shouldShowBackgroundTerminalSuggestion(): boolean {
		const oneHourAgo = Date.now() - 60 * 60 * 1000

		// Clean old timestamps (older than 1 hour)
		this.shellIntegrationWarningTracker.timestamps = this.shellIntegrationWarningTracker.timestamps.filter(
			(ts) => ts > oneHourAgo,
		)

		// Add current warning
		this.shellIntegrationWarningTracker.timestamps.push(Date.now())

		// Check if we've shown suggestion recently (within last hour)
		if (
			this.shellIntegrationWarningTracker.lastSuggestionShown &&
			Date.now() - this.shellIntegrationWarningTracker.lastSuggestionShown < 60 * 60 * 1000
		) {
			return false
		}

		// Show suggestion if 3+ warnings in last hour
		if (this.shellIntegrationWarningTracker.timestamps.length >= 3) {
			this.shellIntegrationWarningTracker.lastSuggestionShown = Date.now()
			return true
		}

		return false
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
