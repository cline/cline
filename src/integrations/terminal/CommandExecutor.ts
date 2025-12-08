import { isSubagentCommand, transformClineCommand } from "@integrations/cli-subagents/subagent_command"
import { ClineToolResponseContent } from "@shared/messages"
import { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { BackgroundCommandExecutor, BackgroundCommandExecutorConfig } from "./backgroundCommand/BackgroundCommandExecutor"
import { BackgroundCommandTracker } from "./backgroundCommand/BackgroundCommandTracker"
import { ActiveBackgroundCommand, CommandExecutorCallbacks, CommandExecutorConfig, ICommandExecutor } from "./ICommandExecutor"
import { VscodeCommandExecutor, VscodeCommandExecutorConfig } from "./vscode/VscodeCommandExecutor"

/**
 * Full configuration for CommandExecutor factory
 * Includes all fields needed by both VSCode and Background executors
 */
export interface FullCommandExecutorConfig extends CommandExecutorConfig {
	terminalManager: VscodeTerminalManager
	backgroundCommandTracker: BackgroundCommandTracker | undefined
}

// Re-export types for convenience
export type { CommandExecutorCallbacks, CommandExecutorConfig, ICommandExecutor } from "./ICommandExecutor"

/**
 * CommandExecutor - Factory/Delegator Pattern
 *
 * This class acts as a factory that creates the appropriate command executor
 * based on the terminal execution mode:
 *
 * - "vscodeTerminal" mode: Uses VscodeCommandExecutor
 *   - VSCode's integrated terminal with shell integration
 *   - Commands run to completion (blocking)
 *   - Real-time output streaming to chat UI
 *
 * - "backgroundExec" mode: Uses BackgroundCommandExecutor
 *   - Standalone/CLI mode with detached processes
 *   - Supports "Proceed While Running" with background tracking
 *   - Output logged to temp files
 *   - 10-minute hard timeout protection
 *   - Command cancellation support
 *
 * IMPORTANT: Subagent commands (cline CLI) are ALWAYS routed to BackgroundCommandExecutor
 * regardless of the configured mode. This ensures subagents run in hidden/background
 * terminals rather than cluttering the user's visible VSCode terminal.
 *
 * The factory pattern allows Task class to use a single interface while
 * the actual implementation is selected at construction time based on mode.
 */
export class CommandExecutor implements ICommandExecutor {
	private vscodeExecutor: VscodeCommandExecutor | undefined
	private backgroundExecutor: BackgroundCommandExecutor
	private cwd: string

	constructor(config: FullCommandExecutorConfig, callbacks: CommandExecutorCallbacks) {
		this.cwd = config.cwd

		// Always create BackgroundCommandExecutor (needed for subagents even in VSCode mode)
		// BackgroundCommandExecutor will load StandaloneTerminalManager for detached process execution
		const backgroundConfig: BackgroundCommandExecutorConfig = {
			terminalManager: config.terminalManager,
			backgroundCommandTracker: config.backgroundCommandTracker,
			terminalExecutionMode: "backgroundExec",
			cwd: config.cwd,
			taskId: config.taskId,
			ulid: config.ulid,
			standaloneTerminalModulePath: config.standaloneTerminalModulePath,
		}
		this.backgroundExecutor = new BackgroundCommandExecutor(backgroundConfig, callbacks)

		// Only create VscodeCommandExecutor if in VSCode mode
		if (config.terminalExecutionMode === "vscodeTerminal") {
			const vscodeConfig: VscodeCommandExecutorConfig = {
				terminalManager: config.terminalManager,
				terminalExecutionMode: config.terminalExecutionMode,
				cwd: config.cwd,
				taskId: config.taskId,
				ulid: config.ulid,
				standaloneTerminalModulePath: config.standaloneTerminalModulePath,
			}
			this.vscodeExecutor = new VscodeCommandExecutor(vscodeConfig, callbacks)
		}
	}

	/**
	 * Execute a command in the terminal
	 *
	 * Routing logic:
	 * 1. Subagent commands (cline CLI) → Always use BackgroundCommandExecutor
	 *    This ensures subagents run in hidden terminals, not cluttering the user's VSCode terminal
	 * 2. Regular commands → Use the configured executor based on terminalExecutionMode
	 */
	execute(command: string, timeoutSeconds: number | undefined): Promise<[boolean, ClineToolResponseContent]> {
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

		// Route subagents to background executor (hidden terminal)
		// This prevents subagent output from cluttering the user's visible VSCode terminal
		if (isSubagent) {
			return this.backgroundExecutor.execute(command, timeoutSeconds)
		}

		// Regular commands use the configured executor
		if (this.vscodeExecutor) {
			return this.vscodeExecutor.execute(command)
		}
		return this.backgroundExecutor.execute(command, timeoutSeconds)
	}

	/**
	 * Cancel the currently running background command
	 * Delegates to BackgroundCommandExecutor (VSCode executor doesn't support cancellation)
	 */
	cancelBackgroundCommand(): Promise<boolean> {
		return this.backgroundExecutor.cancelBackgroundCommand()
	}

	/**
	 * Check if there's an active background command
	 */
	hasActiveBackgroundCommand(): boolean {
		return this.backgroundExecutor.hasActiveBackgroundCommand()
	}

	/**
	 * Get the active background command info
	 */
	getActiveBackgroundCommand(): ActiveBackgroundCommand | undefined {
		return this.backgroundExecutor.getActiveBackgroundCommand()
	}
}
