/**
 * Shared terminal process types for the VSCode foreground terminal manager.
 *
 * These types describe the event/process surface implemented by
 * `VscodeTerminalProcess` and consumed by `VscodeTerminalManager`. The
 * standalone (CLI/JetBrains) terminal manager was removed — those hosts run
 * commands through the SDK's built-in `run_commands` (child_process) tool.
 */

import type { EventEmitter } from "events"

// =============================================================================
// Terminal Process Types
// =============================================================================

/**
 * Event types for terminal process
 */
export interface TerminalCompletionDetails {
	/** Process exit code when available */
	exitCode?: number | null
	/** Termination signal when available */
	signal?: NodeJS.Signals | null
}

export interface TerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: [details?: TerminalCompletionDetails]
	error: [error: Error]
	no_shell_integration: []
}

/**
 * Interface for terminal process implementations.
 * Implemented by VscodeTerminalProcess.
 *
 * Events emitted:
 * - 'line': Emitted for each line of output
 * - 'completed': Emitted when the process completes
 * - 'continue': Emitted when continue() is called
 * - 'error': Emitted on process errors
 * - 'no_shell_integration': Emitted when shell integration is not available
 */
export interface ITerminalProcess extends EventEmitter<TerminalProcessEvents> {
	/**
	 * Whether the process is actively outputting (used to stall API requests)
	 */
	isHot: boolean

	/**
	 * Whether to wait for shell integration before running commands.
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
	 * Get completion metadata for the most recent command execution.
	 */
	getCompletionDetails?(): TerminalCompletionDetails
}

// =============================================================================
// Terminal Types
// =============================================================================

/**
 * Represents a terminal instance with its metadata and state.
 */
export interface TerminalInfo {
	/** Unique identifier for the terminal */
	id: number
	/** The underlying terminal instance */
	terminal: ITerminal
	/** Whether the terminal is currently executing a command */
	busy: boolean
	/** The last command executed in this terminal */
	lastCommand: string
	/** The shell path used by this terminal (e.g., /bin/bash, /bin/zsh) */
	shellPath?: string
	/** Timestamp of last activity */
	lastActive: number
	/** Pending CWD change path (used for tracking directory changes) */
	pendingCwdChange?: string
	/** Promise resolver for CWD change completion */
	cwdResolved?: { resolve: () => void; reject: (err: Error) => void }
}

/**
 * Minimal terminal interface implemented by VSCode terminals.
 */
export interface ITerminal {
	/** Terminal name */
	name: string
	/** Promise that resolves to the process ID */
	processId: Promise<number | undefined>
	/** Shell integration information (if available) */
	shellIntegration?: {
		cwd?: { fsPath: string }
		executeCommand?: (command: string) => {
			read: () => AsyncIterable<string>
		}
	}
	/** Send text to the terminal */
	sendText(text: string, addNewLine?: boolean): void
	/** Show the terminal */
	show(): void
	/** Hide the terminal */
	hide(): void
	/** Dispose of the terminal */
	dispose(): void
}

/**
 * Promise-like interface for terminal process results.
 * Combines Promise<void> with ITerminalProcess for flexible usage.
 * This allows the process to be awaited while also providing access to events.
 */
export type TerminalProcessResultPromise = Promise<void> &
	ITerminalProcess & {
		/** Listen for line output events */
		on(event: "line", listener: (line: string) => void): TerminalProcessResultPromise
		/** Listen for completion event */
		on(event: "completed", listener: (details?: TerminalCompletionDetails) => void): TerminalProcessResultPromise
		/** Listen for continue event */
		on(event: "continue", listener: () => void): TerminalProcessResultPromise
		/** Listen for error events */
		on(event: "error", listener: (error: Error) => void): TerminalProcessResultPromise
		/** Listen for no shell integration event */
		on(event: "no_shell_integration", listener: () => void): TerminalProcessResultPromise
		/** Listen once for any event */
		once(event: string, listener: (...args: any[]) => void): TerminalProcessResultPromise
	}
