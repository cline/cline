/**
 * StandaloneTerminal - A terminal wrapper for standalone environments.
 *
 * This class provides a terminal abstraction that works outside of VSCode,
 * implementing the ITerminal interface for compatibility with the terminal manager.
 */

import type { ChildProcess } from "child_process"

import type { ITerminal, StandaloneTerminalOptions } from "../types"

/**
 * A standalone terminal implementation that doesn't depend on VSCode.
 * Used in CLI and JetBrains environments.
 */
export class StandaloneTerminal implements ITerminal {
	/** Terminal name */
	name: string

	/** Promise that resolves to the process ID */
	processId: Promise<number | undefined>

	/** Terminal creation options */
	creationOptions: StandaloneTerminalOptions

	/** Exit status (if terminal has exited) */
	exitStatus: { code: number } | undefined

	/** Terminal state */
	state: { isInteractedWith: boolean }

	/** Current working directory */
	_cwd: string

	/** Shell path */
	_shellPath: string | undefined

	/** Active child process */
	_process: ChildProcess | null = null

	/** Process ID of the active process */
	_processId: number | null = null

	/** Mock shell integration for compatibility */
	shellIntegration: {
		cwd: { fsPath: string }
		executeCommand: (command: string) => {
			read: () => AsyncGenerator<string, void, unknown>
		}
	}

	constructor(options: StandaloneTerminalOptions = {}) {
		this.name = options.name || `Terminal ${Math.floor(Math.random() * 10000)}`
		this.processId = Promise.resolve(Math.floor(Math.random() * 100000))
		this.creationOptions = options
		this.exitStatus = undefined
		this.state = { isInteractedWith: false }
		this._cwd = options.cwd || process.cwd()
		this._shellPath = options.shellPath

		// Mock shell integration for compatibility
		this.shellIntegration = {
			cwd: { fsPath: this._cwd },
			executeCommand: (_command: string) => {
				// Return a mock execution object that the TerminalProcess expects
				return {
					read: async function* (): AsyncGenerator<string, void, unknown> {
						// This will be handled by our StandaloneTerminalProcess
						yield ""
					},
				}
			},
		}

		console.log(`[StandaloneTerminal] Created terminal: ${this.name} in ${this._cwd}`)
	}

	/**
	 * Send text to the terminal.
	 * @param text The text to send
	 * @param addNewLine Whether to add a newline (default: true)
	 */
	sendText(text: string, addNewLine: boolean = true): void {
		console.log(`[StandaloneTerminal] sendText: ${text}`)

		// If we have an active process, send input to it
		if (this._process && !this._process.killed) {
			try {
				this._process.stdin?.write(text + (addNewLine ? "\n" : ""))
			} catch (error) {
				console.error(`[StandaloneTerminal] Error sending text to process:`, error)
			}
		} else {
			// For compatibility with old behavior, we could spawn a new process
			console.log(`[StandaloneTerminal] No active process to send text to`)
		}
	}

	/**
	 * Show the terminal (no-op in standalone mode).
	 */
	show(): void {
		console.log(`[StandaloneTerminal] show: ${this.name}`)
		this.state.isInteractedWith = true
	}

	/**
	 * Hide the terminal (no-op in standalone mode).
	 */
	hide(): void {
		console.log(`[StandaloneTerminal] hide: ${this.name}`)
	}

	/**
	 * Dispose of the terminal and kill any running process.
	 */
	dispose(): void {
		console.log(`[StandaloneTerminal] dispose: ${this.name}`)
		if (this._process && !this._process.killed) {
			this._process.kill("SIGTERM")
		}
	}
}
