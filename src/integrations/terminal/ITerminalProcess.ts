/**
 * ITerminalProcess - Shared interface for terminal process implementations.
 *
 * This interface defines the contract that both VscodeTerminalProcess and
 * StandaloneTerminalProcess must implement. It enables the CommandExecutor
 * to work with any terminal process implementation polymorphically.
 *
 * Events emitted:
 * - 'line': Emitted for each line of output
 * - 'completed': Emitted when the process completes
 * - 'continue': Emitted when continue() is called
 * - 'error': Emitted on process errors
 * - 'no_shell_integration': Emitted when shell integration is not available (VSCode only)
 */

import { EventEmitter } from "events"

/**
 * Event types for terminal process
 */
export interface TerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: []
	error: [error: Error]
	no_shell_integration: []
}

/**
 * Interface for terminal process implementations.
 * Both VscodeTerminalProcess and StandaloneTerminalProcess implement this interface.
 */
export interface ITerminalProcess extends EventEmitter<TerminalProcessEvents> {
	/**
	 * Whether the process is actively outputting (used to stall API requests)
	 */
	isHot: boolean

	/**
	 * Whether to wait for shell integration before running commands.
	 * VSCode processes may need to wait, standalone processes don't.
	 */
	waitForShellIntegration: boolean

	/**
	 * Continue execution without waiting for completion.
	 * Stops event emission and resolves the promise.
	 * This is called when user clicks "Proceed While Running".
	 */
	continue(): void

	/**
	 * Get output that hasn't been retrieved yet.
	 * @returns The unretrieved output
	 */
	getUnretrievedOutput(): string

	/**
	 * Terminate the process if it's still running.
	 * Only available for standalone processes (child_process).
	 * VSCode terminal processes cannot be terminated via this interface.
	 */
	terminate?(): void
}

/**
 * Type for a terminal process combined with a Promise.
 * This allows the process to be awaited while also providing access to events.
 */
export type TerminalProcessResultPromise = ITerminalProcess & Promise<void>
