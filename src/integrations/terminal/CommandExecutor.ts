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
import { findLastIndex } from "@shared/array"
import { ClineToolResponseContent } from "@shared/messages"
import { orchestrateCommandExecution } from "./CommandOrchestrator"
import { StandaloneTerminalManager } from "./standalone/StandaloneTerminalManager"
import type {
	CommandExecutorCallbacks,
	CommandExecutorConfig,
	ITerminalManager,
	ShellIntegrationWarningTracker,
	TerminalProcessResultPromise,
} from "./types"

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

	// Track the currently executing foreground process for cancellation
	private currentProcess: TerminalProcessResultPromise | null = null

	// Flag to track if the current command was cancelled externally
	private wasCancelledExternally = false

	// Track shell integration warnings to determine when to show background terminal suggestion
	private shellIntegrationWarningTracker: ShellIntegrationWarningTracker = {
		timestamps: [],
		lastSuggestionShown: undefined,
	}

	constructor(config: CommandExecutorConfig, callbacks: CommandExecutorCallbacks) {
		this.cwd = config.cwd
		this.taskId = config.taskId
		this.ulid = config.ulid
		this.terminalExecutionMode = config.terminalExecutionMode
		this.terminalManager = config.terminalManager
		this.callbacks = callbacks

		// When in backgroundExec mode, the terminalManager is already a StandaloneTerminalManager
		// created by Task. We should reuse it so that Task.getEnvironmentDetails() can see
		// the terminals and processes we create (for isHot logic, busy terminals, etc.)
		if (config.terminalExecutionMode === "backgroundExec" && config.terminalManager instanceof StandaloneTerminalManager) {
			// Reuse the same instance that Task is using
			this.standaloneManager = config.terminalManager
			Logger.info(`[CommandExecutor] Reusing Task's StandaloneTerminalManager for backgroundExec mode`)
		} else {
			// Create new StandaloneTerminalManager for subagents (even in VSCode mode)
			// This ensures subagents run in hidden terminals, not cluttering the user's VSCode terminal
			this.standaloneManager = new StandaloneTerminalManager()
			Logger.info(`[CommandExecutor] Created new StandaloneTerminalManager for subagents`)

			// Copy settings from the provided terminalManager to ensure consistency
			if ("shellIntegrationTimeout" in config.terminalManager) {
				const tm = config.terminalManager as any
				this.standaloneManager.setShellIntegrationTimeout(tm.shellIntegrationTimeout || 4000)
				this.standaloneManager.setTerminalReuseEnabled(tm.terminalReuseEnabled ?? true)
				this.standaloneManager.setTerminalOutputLineLimit(tm.terminalOutputLineLimit || 500)
				this.standaloneManager.setSubagentTerminalOutputLineLimit(tm.subagentTerminalOutputLineLimit || 2000)
			}
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

		// Reset cancellation flag and track the current process
		this.wasCancelledExternally = false
		this.currentProcess = process
		const clearCurrentProcess = () => {
			this.currentProcess = null
		}
		process.once("completed", clearCurrentProcess)
		process.once("error", clearCurrentProcess)

		// Use shared orchestration logic
		// The StandaloneTerminalManager handles background command tracking internally
		const result = await orchestrateCommandExecution(process, manager, this.callbacks, {
			command,
			timeoutSeconds,
			// When "Proceed While Running" is triggered, track the command in the manager
			// Returns the log file path so the orchestrator can send it to the UI
			// existingOutput contains all output lines captured so far
			onProceedWhileRunning: useStandalone
				? (existingOutput: string[]) => {
						const backgroundCmd = this.standaloneManager.trackBackgroundCommand(process, command, existingOutput)
						return { logFilePath: backgroundCmd.logFilePath }
					}
				: undefined,
			showShellIntegrationSuggestion: this.shouldShowBackgroundTerminalSuggestion(),
			terminalType: useStandalone ? "standalone" : "vscode",
		})

		// Capture subagent telemetry
		if (isSubagent && subAgentStartTime > 0) {
			const durationMs = Math.round(performance.now() - subAgentStartTime)
			telemetryService.captureSubagentExecution(this.ulid, durationMs, result.outputLines.length, result.completed)
		}

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
		const runningCommands = this.standaloneManager.getRunningBackgroundCommands()
		for (const cmd of runningCommands) {
			if (this.standaloneManager.cancelBackgroundCommand(cmd.id)) {
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
	 * Delegates to StandaloneTerminalManager.
	 */
	hasActiveBackgroundCommand(): boolean {
		return this.standaloneManager.hasActiveBackgroundCommands()
	}

	/**
	 * Get a summary of background commands for environment details.
	 * Delegates to StandaloneTerminalManager which tracks multiple commands.
	 */
	getBackgroundCommandSummary(): string | undefined {
		const summary = this.standaloneManager.getBackgroundCommandsSummary()
		return summary || undefined
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
}
