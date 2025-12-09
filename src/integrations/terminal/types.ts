/**
 * Shared terminal types and interfaces for both VSCode and Standalone terminal managers.
 * These types ensure compatibility between the VSCode-based TerminalManager and
 * the StandaloneTerminalManager used in CLI/JetBrains environments.
 */

import { EventEmitter } from "events"

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
 * Minimal terminal interface that both VSCode terminals and standalone terminals implement.
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
 * Terminal process result that combines Promise functionality with event emission.
 * Allows for both awaiting completion and listening to real-time output.
 */
export interface ITerminalProcessResult extends EventEmitter {
	/** Whether the process is actively outputting (hot) */
	isHot: boolean
	/** Whether we're waiting for shell integration to activate */
	waitForShellIntegration: boolean
	/** Continue execution without waiting for completion */
	continue(): void
	/** Terminate the process (if supported) */
	terminate?(): void
	/** Get output that hasn't been retrieved yet */
	getUnretrievedOutput(): string
}

/**
 * Promise-like interface for terminal process results.
 * Combines Promise<void> with ITerminalProcessResult for flexible usage.
 */
export type TerminalProcessResultPromise = Promise<void> &
	ITerminalProcessResult & {
		/** Listen for line output events */
		on(event: "line", listener: (line: string) => void): TerminalProcessResultPromise
		/** Listen for completion event */
		on(event: "completed", listener: () => void): TerminalProcessResultPromise
		/** Listen for continue event */
		on(event: "continue", listener: () => void): TerminalProcessResultPromise
		/** Listen for error events */
		on(event: "error", listener: (error: Error) => void): TerminalProcessResultPromise
		/** Listen for no shell integration event */
		on(event: "no_shell_integration", listener: () => void): TerminalProcessResultPromise
		/** Listen once for any event */
		once(event: string, listener: (...args: any[]) => void): TerminalProcessResultPromise
	}

/**
 * Interface for terminal managers (both VSCode and Standalone implementations).
 * Defines the contract that both implementations must follow.
 */
export interface ITerminalManager {
	/**
	 * Run a command in the specified terminal.
	 * @param terminalInfo The terminal to run the command in
	 * @param command The command to execute
	 * @returns A promise-like object that emits events and resolves on completion
	 */
	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise

	/**
	 * Get or create a terminal for the specified working directory.
	 * @param cwd The working directory for the terminal
	 * @returns The terminal info for an available terminal
	 */
	getOrCreateTerminal(cwd: string): Promise<TerminalInfo>

	/**
	 * Get terminals filtered by busy state.
	 * @param busy Whether to get busy or idle terminals
	 * @returns Array of terminal info with id and last command
	 */
	getTerminals(busy: boolean): { id: number; lastCommand: string }[]

	/**
	 * Get output that hasn't been retrieved yet from a terminal.
	 * @param terminalId The terminal ID
	 * @returns The unretrieved output string
	 */
	getUnretrievedOutput(terminalId: number): string

	/**
	 * Check if a terminal's process is actively outputting.
	 * @param terminalId The terminal ID
	 * @returns Whether the process is hot
	 */
	isProcessHot(terminalId: number): boolean

	/**
	 * Dispose of all terminals and clean up resources.
	 */
	disposeAll(): void

	/**
	 * Set the timeout for waiting for shell integration.
	 * @param timeout Timeout in milliseconds
	 */
	setShellIntegrationTimeout(timeout: number): void

	/**
	 * Enable or disable terminal reuse.
	 * @param enabled Whether to enable terminal reuse
	 */
	setTerminalReuseEnabled(enabled: boolean): void

	/**
	 * Set the maximum number of output lines to keep.
	 * @param limit Maximum number of lines
	 */
	setTerminalOutputLineLimit(limit: number): void

	/**
	 * Set the maximum number of output lines for subagent commands.
	 * @param limit Maximum number of lines
	 */
	setSubagentTerminalOutputLineLimit(limit: number): void

	/**
	 * Set the default terminal profile.
	 * @param profile The profile identifier
	 */
	setDefaultTerminalProfile(profile: string): void

	/**
	 * Process output lines, potentially truncating if over limit.
	 * @param outputLines Array of output lines
	 * @param overrideLimit Optional limit override
	 * @param isSubagentCommand Whether this is a subagent command
	 * @returns Processed output string
	 */
	processOutput(outputLines: string[], overrideLimit?: number, isSubagentCommand?: boolean): string
}

/**
 * Options for creating a standalone terminal.
 */
export interface StandaloneTerminalOptions {
	/** Terminal name */
	name?: string
	/** Working directory */
	cwd?: string
	/** Shell path to use */
	shellPath?: string
}
