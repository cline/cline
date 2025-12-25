/**
 * StandaloneTerminalManager - Main terminal manager for standalone environments.
 *
 * This class provides the same interface as VSCode's TerminalManager but works
 * in CLI and JetBrains environments by using subprocess management instead of
 * VSCode's terminal API.
 *
 * Also handles background command tracking for "Proceed While Running" functionality:
 * - Logs output to temp files for later retrieval
 * - Tracks command status (running, completed, error, timed_out)
 * - Implements 10-minute hard timeout to prevent zombie processes
 * - Provides summary for environment details
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
	BACKGROUND_COMMAND_TIMEOUT_MS,
	DEFAULT_SUBAGENT_TERMINAL_OUTPUT_LINE_LIMIT,
	DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT,
} from "../constants"
import type { BackgroundCommand, ITerminalManager, TerminalInfo, TerminalProcessResultPromise } from "../types"
import { StandaloneTerminalProcess } from "./StandaloneTerminalProcess"
import { StandaloneTerminalRegistry } from "./StandaloneTerminalRegistry"

// Re-export BackgroundCommand for backwards compatibility
export type { BackgroundCommand }

/**
 * Helper function to merge a process with a promise for the TerminalProcessResultPromise type.
 * This allows the returned object to be both awaitable and have event methods.
 */
function mergePromise(process: StandaloneTerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
	const nativePromisePrototype = (async () => {})().constructor.prototype
	const descriptors = ["then", "catch", "finally"].map((property) => [
		property,
		Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property),
	]) as [string, PropertyDescriptor][]

	for (const [property, descriptor] of descriptors) {
		if (descriptor) {
			const value = (descriptor.value as Function).bind(promise)
			Reflect.defineProperty(process, property, { ...descriptor, value })
		}
	}

	// Ensure terminate() is accessible on the merged promise
	// This allows Task.cancelBackgroundCommand() to kill the process
	if (process.terminate && typeof process.terminate === "function") {
		Object.defineProperty(process, "terminate", {
			value: process.terminate.bind(process),
			writable: false,
			enumerable: false,
			configurable: false,
		})
	}

	return process as unknown as TerminalProcessResultPromise
}

/**
 * Terminal manager for standalone (non-VSCode) environments.
 * Implements ITerminalManager for compatibility with the Task class.
 */
export class StandaloneTerminalManager implements ITerminalManager {
	/** Registry for tracking terminals */
	private registry: StandaloneTerminalRegistry = new StandaloneTerminalRegistry()

	/** Map of terminal ID to process */
	private processes: Map<number, StandaloneTerminalProcess> = new Map()

	/** Set of terminal IDs managed by this instance */
	private terminalIds: Set<number> = new Set()

	/** Timeout for shell integration (not used in standalone, but kept for interface compatibility) */
	private shellIntegrationTimeout: number = 4000

	/** Whether terminal reuse is enabled */
	private terminalReuseEnabled: boolean = true

	/** Maximum output lines to keep */
	private terminalOutputLineLimit: number = DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT

	/** Maximum output lines for subagent commands */
	private subagentTerminalOutputLineLimit: number = DEFAULT_SUBAGENT_TERMINAL_OUTPUT_LINE_LIMIT

	/** Default terminal profile */
	private defaultTerminalProfile: string = "default"

	// =========================================================================
	// Background Command Tracking
	// =========================================================================

	/** Map of background command ID to command info */
	private backgroundCommands: Map<string, BackgroundCommand> = new Map()

	/** Map of background command ID to log file write stream */
	private logStreams: Map<string, fs.WriteStream> = new Map()

	/** Map of background command ID to timeout handle */
	private backgroundTimeouts: Map<string, NodeJS.Timeout> = new Map()

	/**
	 * Run a command in the specified terminal.
	 * @param terminalInfo The terminal to run the command in
	 * @param command The command to execute
	 * @returns A promise-like object that emits events and resolves on completion
	 */
	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise {
		terminalInfo.busy = true
		terminalInfo.lastCommand = command

		const process = new StandaloneTerminalProcess()
		this.processes.set(terminalInfo.id, process)

		process.once("completed", () => {
			terminalInfo.busy = false
		})

		process.once("error", (_error: Error) => {
			terminalInfo.busy = false
		})

		// Create promise for the process
		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => resolve())
			process.once("error", (error: Error) => reject(error))
		})

		// Run the command immediately (no shell integration wait needed)
		process.run(terminalInfo.terminal, command)

		// Return merged promise/process object
		return mergePromise(process, promise)
	}

	/**
	 * Get or create a terminal for the specified working directory.
	 * @param cwd The working directory for the terminal
	 * @returns The terminal info for an available terminal
	 */
	async getOrCreateTerminal(cwd: string): Promise<TerminalInfo> {
		const terminals = this.registry.getAllTerminals()

		// Find available terminal with matching CWD
		const matchingTerminal = terminals.find((t) => {
			if (t.busy) {
				return false
			}
			return (t.terminal as any)._cwd === cwd
		})

		if (matchingTerminal) {
			this.terminalIds.add(matchingTerminal.id)
			return matchingTerminal
		}

		// Find any available terminal if reuse is enabled
		if (this.terminalReuseEnabled) {
			const availableTerminal = terminals.find((t) => !t.busy)
			if (availableTerminal) {
				// Change directory
				await this.runCommand(availableTerminal, `cd "${cwd}"`)
				;(availableTerminal.terminal as any)._cwd = cwd
				if (availableTerminal.terminal.shellIntegration?.cwd) {
					availableTerminal.terminal.shellIntegration.cwd.fsPath = cwd
				}
				this.terminalIds.add(availableTerminal.id)
				return availableTerminal
			}
		}

		// Create new terminal
		const newTerminalInfo = this.registry.createTerminal({
			cwd: cwd,
			name: `Cline Terminal ${this.registry.size + 1}`,
		})
		this.terminalIds.add(newTerminalInfo.id)
		return newTerminalInfo
	}

	/**
	 * Get terminals filtered by busy state.
	 * @param busy Whether to get busy or idle terminals
	 * @returns Array of terminal info with id and last command
	 */
	getTerminals(busy: boolean): { id: number; lastCommand: string }[] {
		const allTerminalIds = Array.from(this.terminalIds)

		const terminals = allTerminalIds
			.map((id) => this.registry.getTerminal(id))
			.filter((t): t is TerminalInfo => {
				if (t === undefined) {
					return false
				}
				return t.busy === busy
			})
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }))

		return terminals
	}

	/**
	 * Get output that hasn't been retrieved yet from a terminal.
	 * @param terminalId The terminal ID
	 * @returns The unretrieved output string
	 */
	getUnretrievedOutput(terminalId: number): string {
		if (!this.terminalIds.has(terminalId)) {
			return ""
		}
		const process = this.processes.get(terminalId)
		return process ? process.getUnretrievedOutput() : ""
	}

	/**
	 * Check if a terminal's process is actively outputting.
	 * @param terminalId The terminal ID
	 * @returns Whether the process is hot
	 */
	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	/**
	 * Process output lines, potentially truncating if over limit.
	 * @param outputLines Array of output lines
	 * @param overrideLimit Optional limit override
	 * @param isSubagentCommand Whether this is a subagent command
	 * @returns Processed output string
	 */
	processOutput(outputLines: string[], overrideLimit?: number, isSubagentCommand?: boolean): string {
		const limit = isSubagentCommand
			? overrideLimit !== undefined
				? overrideLimit
				: this.subagentTerminalOutputLineLimit
			: this.terminalOutputLineLimit
		if (outputLines.length > limit) {
			const halfLimit = Math.floor(limit / 2)
			const start = outputLines.slice(0, halfLimit)
			const end = outputLines.slice(outputLines.length - halfLimit)
			return `${start.join("\n")}\n... (output truncated) ...\n${end.join("\n")}`.trim()
		}
		return outputLines.join("\n").trim()
	}

	/**
	 * Dispose of all terminals and clean up resources.
	 */
	disposeAll(): void {
		// Dispose background commands first
		this.disposeBackgroundCommands()

		// Terminate all processes
		for (const [_terminalId, process] of this.processes) {
			if (process && process.terminate) {
				process.terminate()
			}
		}

		// Clear all tracking
		this.terminalIds.clear()
		this.processes.clear()

		// Dispose all terminals
		for (const terminalInfo of this.registry.getAllTerminals()) {
			terminalInfo.terminal.dispose()
		}

		this.registry.clear()
	}

	/**
	 * Set the timeout for waiting for shell integration.
	 * @param timeout Timeout in milliseconds
	 */
	setShellIntegrationTimeout(timeout: number): void {
		this.shellIntegrationTimeout = timeout
	}

	/**
	 * Enable or disable terminal reuse.
	 * @param enabled Whether to enable terminal reuse
	 */
	setTerminalReuseEnabled(enabled: boolean): void {
		this.terminalReuseEnabled = enabled
	}

	/**
	 * Set the maximum number of output lines to keep.
	 * @param limit Maximum number of lines
	 */
	setTerminalOutputLineLimit(limit: number): void {
		this.terminalOutputLineLimit = limit
	}

	/**
	 * Set the maximum number of output lines for subagent commands.
	 * @param limit Maximum number of lines
	 */
	setSubagentTerminalOutputLineLimit(limit: number): void {
		this.subagentTerminalOutputLineLimit = limit
	}

	/**
	 * Set the default terminal profile.
	 * @param profile The profile identifier
	 * @returns Object with information about closed terminals and remaining busy terminals
	 */
	setDefaultTerminalProfile(profile: string): { closedCount: number; busyTerminals: TerminalInfo[] } {
		const previousProfile = this.defaultTerminalProfile
		this.defaultTerminalProfile = profile

		// If profile changed, handle terminal cleanup like TerminalManager does
		if (previousProfile !== profile) {
			return this.handleTerminalProfileChange(profile)
		}

		return { closedCount: 0, busyTerminals: [] }
	}

	// Additional methods required for TerminalManager compatibility

	/** Disposables array (for VSCode compatibility) */
	disposables: any[] = []

	/**
	 * Find a TerminalInfo by its terminal instance.
	 * @param terminal The terminal instance to find
	 * @returns The terminal info or undefined
	 */
	findTerminalInfoByTerminal(terminal: any): TerminalInfo | undefined {
		const terminals = this.registry.getAllTerminals()
		return terminals.find((t) => t.terminal === terminal)
	}

	/**
	 * Check if a terminal's CWD matches its expected pending change.
	 * @param terminalInfo The terminal info to check
	 * @returns Whether the CWD matches
	 */
	isCwdMatchingExpected(terminalInfo: TerminalInfo): boolean {
		if (!(terminalInfo as any).pendingCwdChange) {
			return false
		}
		const currentCwd = (terminalInfo.terminal as any)._cwd
		const targetCwd = (terminalInfo as any).pendingCwdChange
		return currentCwd === targetCwd
	}

	/**
	 * Filter terminals based on a provided criteria function.
	 * @param filterFn Function that accepts TerminalInfo and returns boolean
	 * @returns Array of terminals that match the criteria
	 */
	filterTerminals(filterFn: (terminal: TerminalInfo) => boolean): TerminalInfo[] {
		const terminals = this.registry.getAllTerminals()
		return terminals.filter(filterFn)
	}

	/**
	 * Close terminals that match the provided criteria.
	 * @param filterFn Function that accepts TerminalInfo and returns boolean for terminals to close
	 * @param force If true, closes even busy terminals
	 * @returns Number of terminals closed
	 */
	closeTerminals(filterFn: (terminal: TerminalInfo) => boolean, force: boolean = false): number {
		const terminalsToClose = this.filterTerminals(filterFn)
		let closedCount = 0

		for (const terminalInfo of terminalsToClose) {
			if (terminalInfo.busy && !force) {
				continue
			}

			this.terminalIds.delete(terminalInfo.id)
			this.processes.delete(terminalInfo.id)
			terminalInfo.terminal.dispose()
			this.registry.removeTerminal(terminalInfo.id)
			closedCount++
		}

		return closedCount
	}

	/**
	 * Handle terminal management when the terminal profile changes.
	 * @param newShellPath New shell path to use
	 * @returns Object with information about closed terminals and remaining busy terminals
	 */
	handleTerminalProfileChange(newShellPath: string | undefined): {
		closedCount: number
		busyTerminals: TerminalInfo[]
	} {
		const closedCount = this.closeTerminals(
			(terminal) => !terminal.busy && (terminal as any).shellPath !== newShellPath,
			false,
		)
		const busyTerminals = this.filterTerminals((terminal) => terminal.busy && (terminal as any).shellPath !== newShellPath)
		return { closedCount, busyTerminals }
	}

	/**
	 * Force closure of all terminals (including busy ones).
	 * @returns Number of terminals closed
	 */
	closeAllTerminals(): number {
		return this.closeTerminals(() => true, true)
	}

	// =========================================================================
	// Background Command Tracking Methods
	// =========================================================================

	/**
	 * Track a command that will continue running in the background.
	 * Called when user clicks "Proceed While Running".
	 * Creates a log file and pipes output to it.
	 * Sets up a 10-minute hard timeout to prevent zombie processes.
	 *
	 * @param process The terminal process to track
	 * @param command The command string being executed
	 * @param existingOutput Output lines already captured before tracking started
	 * @returns The background command info with log file path
	 */
	trackBackgroundCommand(
		process: TerminalProcessResultPromise,
		command: string,
		existingOutput: string[] = [],
	): BackgroundCommand {
		const id = `background-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
		const logFilePath = path.join(os.tmpdir(), `cline-${id}.log`)

		const backgroundCommand: BackgroundCommand = {
			id,
			command,
			startTime: Date.now(),
			status: "running",
			logFilePath,
			lineCount: existingOutput.length,
			process,
		}

		// Create write stream for log file
		const logStream = fs.createWriteStream(logFilePath, { flags: "a" })
		this.logStreams.set(id, logStream)

		// Write existing output that was captured before tracking started
		if (existingOutput.length > 0) {
			logStream.write(existingOutput.join("\n") + "\n")
		}

		// Pipe future process output to log file
		process.on("line", (line: string) => {
			backgroundCommand.lineCount++
			logStream.write(line + "\n")
		})

		// Set up 10-minute hard timeout to prevent zombie processes
		const timeoutId = setTimeout(() => {
			if (backgroundCommand.status === "running") {
				backgroundCommand.status = "timed_out"
				logStream.write("\n[TIMEOUT] Process killed after 10 minutes\n")
				logStream.end()

				// Terminate the process if it has a terminate method
				if (process && typeof (process as any).terminate === "function") {
					;(process as any).terminate()
				}
			}
		}, BACKGROUND_COMMAND_TIMEOUT_MS)
		this.backgroundTimeouts.set(id, timeoutId)

		// Listen for completion - clear timeout
		process.on("completed", () => {
			// Guard: Skip if already handled by timeout
			if (backgroundCommand.status !== "running") {
				return
			}
			const timeout = this.backgroundTimeouts.get(id)
			if (timeout) {
				clearTimeout(timeout)
				this.backgroundTimeouts.delete(id)
			}
			backgroundCommand.status = "completed"
			logStream.end()
		})

		// Listen for errors - clear timeout
		process.on("error", (error: Error) => {
			// Guard: Skip if already handled by timeout
			if (backgroundCommand.status !== "running") {
				return
			}
			const timeout = this.backgroundTimeouts.get(id)
			if (timeout) {
				clearTimeout(timeout)
				this.backgroundTimeouts.delete(id)
			}
			backgroundCommand.status = "error"
			// Try to extract exit code from error message if available
			const exitCodeMatch = error.message.match(/exit code (\d+)/)
			if (exitCodeMatch) {
				backgroundCommand.exitCode = parseInt(exitCodeMatch[1], 10)
			}
			logStream.end()
		})

		this.backgroundCommands.set(id, backgroundCommand)
		return backgroundCommand
	}

	/**
	 * Get a specific background command by ID.
	 */
	getBackgroundCommand(id: string): BackgroundCommand | undefined {
		return this.backgroundCommands.get(id)
	}

	/**
	 * Get all tracked background commands.
	 */
	getAllBackgroundCommands(): BackgroundCommand[] {
		return Array.from(this.backgroundCommands.values())
	}

	/**
	 * Get only running background commands.
	 */
	getRunningBackgroundCommands(): BackgroundCommand[] {
		return this.getAllBackgroundCommands().filter((c) => c.status === "running")
	}

	/**
	 * Check if there are any active background commands.
	 */
	hasActiveBackgroundCommands(): boolean {
		return this.getRunningBackgroundCommands().length > 0
	}

	/**
	 * Cancel/terminate a specific background command.
	 * @param id The background command ID to cancel
	 * @returns true if cancelled, false if not found or already completed
	 */
	cancelBackgroundCommand(id: string): boolean {
		const command = this.backgroundCommands.get(id)
		if (!command || command.status !== "running") {
			return false
		}

		// Clear timeout
		const timeout = this.backgroundTimeouts.get(id)
		if (timeout) {
			clearTimeout(timeout)
			this.backgroundTimeouts.delete(id)
		}

		// Close log stream
		const logStream = this.logStreams.get(id)
		if (logStream) {
			logStream.write("\n[CANCELLED] Command cancelled by user\n")
			logStream.end()
			this.logStreams.delete(id)
		}

		// Terminate process
		if (command.process && typeof (command.process as any).terminate === "function") {
			;(command.process as any).terminate()
		}

		command.status = "error"
		return true
	}

	/**
	 * Get a summary string for environment details.
	 * Shows running background commands with duration, line count, and log paths.
	 */
	getBackgroundCommandsSummary(): string {
		const running = this.getRunningBackgroundCommands()
		if (running.length === 0) {
			return ""
		}

		const lines = [`# Background Commands (${running.length} running)`]
		for (const c of running) {
			const duration = Math.round((Date.now() - c.startTime) / 1000 / 60)
			lines.push(`- ${c.command} (running ${duration}m, ${c.lineCount} lines, log: ${c.logFilePath})`)
		}
		return lines.join("\n")
	}

	/**
	 * Clean up all background command resources.
	 * Called when disposing the manager.
	 */
	disposeBackgroundCommands(): void {
		// Clear all timeouts
		for (const [_id, timeout] of this.backgroundTimeouts) {
			clearTimeout(timeout)
		}
		this.backgroundTimeouts.clear()

		// Close all log streams
		for (const [_id, logStream] of this.logStreams) {
			try {
				logStream.end()
			} catch (_error) {
				// Ignore errors when closing log streams
			}
		}
		this.logStreams.clear()

		// Clear command tracking
		this.backgroundCommands.clear()
	}
}
