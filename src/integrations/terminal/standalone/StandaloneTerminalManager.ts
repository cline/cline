/**
 * StandaloneTerminalManager - Main terminal manager for standalone environments.
 *
 * This class provides the same interface as VSCode's TerminalManager but works
 * in CLI and JetBrains environments by using subprocess management instead of
 * VSCode's terminal API.
 */

import type { ITerminalManager, TerminalInfo, TerminalProcessResultPromise } from "../types"
import { StandaloneTerminalProcess } from "./StandaloneTerminalProcess"
import { StandaloneTerminalRegistry } from "./StandaloneTerminalRegistry"

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
	private terminalOutputLineLimit: number = 500

	/** Maximum output lines for subagent commands */
	private subagentTerminalOutputLineLimit: number = 2000

	/** Default terminal profile */
	private defaultTerminalProfile: string = "default"

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

		process.once("error", (error: Error) => {
			terminalInfo.busy = false
			console.error(`[StandaloneTerminalManager] Command error on terminal ${terminalInfo.id}:`, error)
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
				console.log(`[StandaloneTerminalManager] Reused terminal ${availableTerminal.id} with cd`)
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
		return Array.from(this.terminalIds)
			.map((id) => this.registry.getTerminal(id))
			.filter((t): t is TerminalInfo => t !== undefined && t.busy === busy)
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }))
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
}
