/**
 * ACP Terminal Manager for terminal operations delegation.
 *
 * This manager handles terminal lifecycle operations via the ACP client,
 * allowing the editor to manage terminal processes instead of the agent
 * spawning its own processes.
 *
 * Implements ITerminalManager interface for compatibility with the Task class.
 *
 * @module acp
 */

import type * as acp from "@agentclientprotocol/sdk"
import type { TerminalHandle } from "@agentclientprotocol/sdk"
import {
	DEFAULT_SUBAGENT_TERMINAL_OUTPUT_LINE_LIMIT,
	DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT,
	PROCESS_HOT_TIMEOUT_NORMAL,
} from "@integrations/terminal/constants"
import type {
	ITerminal,
	ITerminalManager,
	ITerminalProcess,
	TerminalInfo,
	TerminalProcessEvents,
	TerminalProcessResultPromise,
} from "@integrations/terminal/types"
import { EventEmitter } from "events"
import { Logger } from "@/shared/services/Logger"
import { SessionIdResolver } from "./ACPDiffViewProvider"

// =============================================================================
// Local Types
// =============================================================================

/**
 * Environment variable for terminal execution.
 */
export interface TerminalEnvVariable {
	name: string
	value: string
}

/**
 * Options for creating a terminal.
 */
export interface CreateTerminalOptions {
	/** The command to execute */
	command: string
	/** Array of command arguments */
	args?: string[]
	/** Working directory for the command (absolute path) */
	cwd?: string
	/** Environment variables to set */
	env?: TerminalEnvVariable[]
	/** Maximum output size in bytes (default: no limit) */
	outputByteLimit?: bigint
}

/**
 * Result of a terminal output request.
 */
export interface TerminalOutputResult {
	/** The terminal output captured so far */
	output: string
	/** Whether the output was truncated due to byte limits */
	truncated: boolean
	/** Exit status if the command has completed */
	exitStatus?: TerminalExitStatus
	/** Whether the operation was successful */
	success: boolean
	/** Error message if the operation failed */
	error?: string
}

/**
 * Exit status of a terminal command.
 */
export interface TerminalExitStatus {
	/** Exit code if the process exited normally */
	exitCode?: number
	/** Signal name if the process was killed by a signal */
	signal?: string
}

/**
 * Result of waiting for terminal exit.
 */
export interface TerminalWaitResult {
	/** Exit code if the process exited normally */
	exitCode?: number
	/** Signal name if the process was killed by a signal */
	signal?: string
	/** Whether the operation was successful */
	success: boolean
	/** Error message if the operation failed */
	error?: string
}

/**
 * Result of a terminal kill/release operation.
 */
export interface TerminalOperationResult {
	/** Whether the operation was successful */
	success: boolean
	/** Error message if the operation failed */
	error?: string
}

/**
 * A managed terminal instance with its handle and metadata.
 */
export interface ManagedTerminal {
	/** Unique terminal ID assigned by the client */
	id: string
	/** Numeric ID for ITerminalManager compatibility */
	numericId: number
	/** The underlying terminal handle from the SDK */
	handle: TerminalHandle
	/** The command that was executed */
	command: string
	/** Command arguments */
	args?: string[]
	/** Working directory */
	cwd?: string
	/** When the terminal was created */
	createdAt: number
	/** Whether the terminal has been released */
	released: boolean
	/** Whether the terminal is busy executing a command */
	busy: boolean
	/** Last command executed */
	lastCommand: string
}

// =============================================================================
// ACP Terminal Process - implements ITerminalProcess
// =============================================================================

/**
 * Terminal process implementation for ACP terminals.
 * Wraps ACP terminal operations and emits events compatible with ITerminalProcess.
 */
class AcpTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	isHot: boolean = false
	waitForShellIntegration: boolean = false

	private _unretrievedOutput: string = ""
	private _continued: boolean = false
	private _completed: boolean = false
	private _hotTimeout: NodeJS.Timeout | null = null
	private _exitWaitTimeout: NodeJS.Timeout | null = null
	private readonly manager: AcpTerminalManager
	private readonly terminalId: string
	private pollInterval: NodeJS.Timeout | null = null

	constructor(manager: AcpTerminalManager, terminalId: string) {
		super()
		this.manager = manager
		this.terminalId = terminalId
	}

	continue(): void {
		this._continued = true
		this.cleanup()
		this.emit("continue")
	}

	getUnretrievedOutput(): string {
		const output = this._unretrievedOutput
		this._unretrievedOutput = ""
		return output
	}

	async terminate(): Promise<void> {
		this.cleanup()
		await this.manager.kill(this.terminalId)
	}

	/**
	 * Clean up all timers and intervals.
	 * Called on continue, terminate, or completion to prevent memory leaks.
	 */
	private cleanup(): void {
		this.stopPolling()
		if (this._hotTimeout) {
			clearTimeout(this._hotTimeout)
			this._hotTimeout = null
		}
		if (this._exitWaitTimeout) {
			clearTimeout(this._exitWaitTimeout)
			this._exitWaitTimeout = null
		}
	}

	private stopPolling(): void {
		if (this.pollInterval) {
			clearInterval(this.pollInterval)
			this.pollInterval = null
		}
	}

	/**
	 * Run the command and start polling for output.
	 * This method sets up the polling loop that emits 'line' events.
	 */
	run(_command: string): void {
		let lastOutput = ""

		// Start polling for output
		this.pollInterval = setInterval(async () => {
			if (this._continued || this._completed) {
				this.stopPolling()
				return
			}

			try {
				const result = await this.manager.getOutput(this.terminalId)
				if (!result.success) {
					this.stopPolling()
					this.emit("error", new Error(result.error || "Failed to get output"))
					return
				}

				// Emit new lines
				if (result.output.length > lastOutput.length) {
					const newOutput = result.output.slice(lastOutput.length)
					this._unretrievedOutput += newOutput
					lastOutput = result.output

					// Mark as hot and reset timeout
					this.setHot()

					// Emit line events
					const lines = newOutput.split("\n")
					for (const line of lines) {
						if (line) {
							this.emit("line", line)
						}
					}
				}

				// Check if completed
				if (result.exitStatus) {
					this._completed = true
					this.stopPolling()
					this.emit("completed")
				}
			} catch (error) {
				this.stopPolling()
				this.emit("error", error instanceof Error ? error : new Error(String(error)))
			}
		}, 100) // Poll every 100ms

		// Also set up exit waiting in parallel
		this.manager.waitForExit(this.terminalId).then((result) => {
			if (result.success && !this._continued && !this._completed) {
				// The polling loop should handle this, but ensure we emit completed
				// Track the timeout so it can be cleaned up if the process is terminated early
				this._exitWaitTimeout = setTimeout(() => {
					if (!this._continued && !this._completed) {
						this._completed = true
						this.cleanup()
						this.emit("completed")
					}
				}, 200)
			}
		})
	}

	private setHot(): void {
		this.isHot = true
		if (this._hotTimeout) {
			clearTimeout(this._hotTimeout)
		}
		this._hotTimeout = setTimeout(() => {
			this.isHot = false
		}, PROCESS_HOT_TIMEOUT_NORMAL)
	}
}

// =============================================================================
// ACP Terminal - implements ITerminal
// =============================================================================

/**
 * Terminal implementation for ACP terminals.
 * Wraps a ManagedTerminal to provide the ITerminal interface.
 */
class AcpTerminal implements ITerminal {
	name: string
	processId: Promise<number | undefined>
	shellIntegration?: {
		cwd?: { fsPath: string }
		executeCommand?: (command: string) => { read: () => AsyncIterable<string> }
	}

	/** Internal reference to the managed terminal */
	_managedTerminal: ManagedTerminal
	/** Internal reference to the manager */
	_manager: AcpTerminalManager
	/** Current working directory */
	_cwd: string

	constructor(managedTerminal: ManagedTerminal, manager: AcpTerminalManager) {
		this._managedTerminal = managedTerminal
		this._manager = manager
		this._cwd = managedTerminal.cwd || ""
		this.name = `ACP Terminal ${managedTerminal.numericId}`
		this.processId = Promise.resolve(managedTerminal.numericId)

		// Set up shell integration info
		this.shellIntegration = {
			cwd: { fsPath: this._cwd },
		}
	}

	sendText(_text: string, _addNewLine?: boolean): void {
		// ACP terminals don't support interactive input this way
		// Commands are run via runCommand
		Logger.debug("[AcpTerminal] sendText not supported for ACP terminals")
	}

	show(): void {
		// No-op for ACP terminals - the client manages display
	}

	hide(): void {
		// No-op for ACP terminals - the client manages display
	}

	dispose(): void {
		// Release the terminal
		this._manager.release(this._managedTerminal.id).catch((err) => {
			Logger.debug("[AcpTerminal] Error releasing terminal:", err)
		})
	}
}

// =============================================================================
// Helper function to merge process with promise
// =============================================================================

/**
 * Helper function to merge a process with a promise for the TerminalProcessResultPromise type.
 * This allows the returned object to be both awaitable and have event methods.
 */
function mergePromise(process: AcpTerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
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

// =============================================================================
// ACP Terminal Manager - implements ITerminalManager
// =============================================================================

/**
 * Manager for terminal operations via the ACP client.
 *
 * This class provides a high-level interface for creating and managing
 * terminals through the ACP protocol, with automatic tracking of
 * terminal instances.
 *
 * Implements ITerminalManager for compatibility with the Task class.
 */
export class AcpTerminalManager implements ITerminalManager {
	private readonly connection: acp.AgentSideConnection
	private readonly clientCapabilities: acp.ClientCapabilities | undefined
	private readonly sessionIdResolver: SessionIdResolver

	/** Active terminals indexed by their string ID */
	private readonly terminals: Map<string, ManagedTerminal> = new Map()

	/** Map from numeric ID to string ID for ITerminalManager compatibility */
	private readonly numericIdToStringId: Map<number, string> = new Map()

	/** Next numeric ID to assign */
	private nextNumericId: number = 1

	/** Active processes indexed by numeric terminal ID */
	private readonly processes: Map<number, AcpTerminalProcess> = new Map()

	/** TerminalInfo wrappers indexed by numeric ID */
	private readonly terminalInfos: Map<number, TerminalInfo> = new Map()

	// Configuration options for ITerminalManager
	private terminalReuseEnabled: boolean = true
	private terminalOutputLineLimit: number = DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT
	private subagentTerminalOutputLineLimit: number = DEFAULT_SUBAGENT_TERMINAL_OUTPUT_LINE_LIMIT

	/**
	 * Creates a new AcpTerminalManager.
	 *
	 * @param connection - The ACP agent-side connection
	 * @param clientCapabilities - The client's advertised capabilities
	 * @param sessionIdResolver - The current session ID
	 */
	constructor(
		connection: acp.AgentSideConnection,
		clientCapabilities: acp.ClientCapabilities | undefined,
		sessionIdResolver: SessionIdResolver,
	) {
		this.connection = connection
		this.clientCapabilities = clientCapabilities
		this.sessionIdResolver = sessionIdResolver
	}

	// =========================================================================
	// ITerminalManager Implementation
	// =========================================================================

	/**
	 * Run a command in the specified terminal.
	 * @param terminalInfo The terminal to run the command in
	 * @param command The command to execute
	 * @returns A promise-like object that emits events and resolves on completion
	 */
	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise {
		const terminal = terminalInfo.terminal as AcpTerminal
		const managedTerminal = terminal._managedTerminal

		// Update state
		terminalInfo.busy = true
		terminalInfo.lastCommand = command
		terminalInfo.lastActive = Date.now()
		managedTerminal.busy = true
		managedTerminal.lastCommand = command

		// Create the process - will be updated with actual terminal ID after creation
		const process = new AcpTerminalProcess(this, managedTerminal.id)
		this.processes.set(managedTerminal.numericId, process)

		// Set up completion handlers
		process.once("completed", () => {
			terminalInfo.busy = false
			managedTerminal.busy = false
		})

		process.once("error", (_error: Error) => {
			terminalInfo.busy = false
			managedTerminal.busy = false
		})

		// Create promise for the process
		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => resolve())
			process.once("completed", () => resolve())
			process.once("error", (error: Error) => reject(error))
		})

		// For ACP, we need to create a new terminal with the command
		// since ACP terminals are command-based, not interactive
		this.runCommandInternal(managedTerminal, command, process)

		return mergePromise(process, promise)
	}

	/**
	 * Internal method to run a command via ACP.
	 */
	private async runCommandInternal(
		managedTerminal: ManagedTerminal,
		command: string,
		process: AcpTerminalProcess,
	): Promise<void> {
		try {
			// Create a new ACP terminal with the command
			const request: acp.CreateTerminalRequest = {
				sessionId: this.getSessionId(),
				command: command,
				cwd: managedTerminal.cwd,
			}

			const handle = await this.connection.createTerminal(request)

			// Remove old terminal entry if it exists
			if (managedTerminal.id && this.terminals.has(managedTerminal.id)) {
				this.terminals.delete(managedTerminal.id)
			}

			// Update the managed terminal with the new handle
			managedTerminal.handle = handle
			managedTerminal.id = handle.id

			// Update the ID mappings
			this.terminals.set(handle.id, managedTerminal)
			this.numericIdToStringId.set(managedTerminal.numericId, handle.id)

			// Update the process with the new terminal ID
			;(process as any).terminalId = handle.id

			// Start the process polling
			process.run(command)
		} catch (error) {
			process.emit("error", error instanceof Error ? error : new Error(String(error)))
		}
	}

	/**
	 * Get or create a terminal for the specified working directory.
	 * @param cwd The working directory for the terminal
	 * @returns The terminal info for an available terminal
	 */
	async getOrCreateTerminal(cwd: string): Promise<TerminalInfo> {
		// Find an available terminal with matching CWD
		for (const [_numericId, terminalInfo] of this.terminalInfos) {
			if (!terminalInfo.busy) {
				const terminal = terminalInfo.terminal as AcpTerminal
				if (terminal._cwd === cwd) {
					return terminalInfo
				}
			}
		}

		// Find any available terminal if reuse is enabled
		if (this.terminalReuseEnabled) {
			for (const [_numericId, terminalInfo] of this.terminalInfos) {
				if (!terminalInfo.busy) {
					// Update the CWD
					const terminal = terminalInfo.terminal as AcpTerminal
					terminal._cwd = cwd
					if (terminal.shellIntegration?.cwd) {
						terminal.shellIntegration.cwd.fsPath = cwd
					}
					terminal._managedTerminal.cwd = cwd
					return terminalInfo
				}
			}
		}

		// Create a new terminal
		const numericId = this.nextNumericId++
		const placeholderId = `pending-${numericId}`

		const managedTerminal: ManagedTerminal = {
			id: placeholderId, // Will be updated when command runs
			numericId,
			handle: null as unknown as TerminalHandle, // Will be set when command runs
			command: "",
			cwd,
			createdAt: Date.now(),
			released: false,
			busy: false,
			lastCommand: "",
		}

		const acpTerminal = new AcpTerminal(managedTerminal, this)

		const terminalInfo: TerminalInfo = {
			id: numericId,
			terminal: acpTerminal,
			busy: false,
			lastCommand: "",
			lastActive: Date.now(),
		}

		this.terminals.set(managedTerminal.id, managedTerminal)
		this.numericIdToStringId.set(numericId, managedTerminal.id)
		this.terminalInfos.set(numericId, terminalInfo)

		Logger.debug("[AcpTerminalManager] Created terminal:", { numericId, cwd })

		return terminalInfo
	}

	/**
	 * Get terminals filtered by busy state.
	 * @param busy Whether to get busy or idle terminals
	 * @returns Array of terminal info with id and last command
	 */
	getTerminals(busy: boolean): { id: number; lastCommand: string }[] {
		const result: { id: number; lastCommand: string }[] = []

		for (const [numericId, terminalInfo] of this.terminalInfos) {
			if (terminalInfo.busy === busy) {
				result.push({
					id: numericId,
					lastCommand: terminalInfo.lastCommand,
				})
			}
		}

		return result
	}

	/**
	 * Get output that hasn't been retrieved yet from a terminal.
	 * @param terminalId The terminal ID (numeric)
	 * @returns The unretrieved output string
	 */
	getUnretrievedOutput(terminalId: number): string {
		const process = this.processes.get(terminalId)
		return process ? process.getUnretrievedOutput() : ""
	}

	/**
	 * Check if a terminal's process is actively outputting.
	 * @param terminalId The terminal ID (numeric)
	 * @returns Whether the process is hot
	 */
	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	/**
	 * Dispose of all terminals and clean up resources.
	 */
	disposeAll(): void {
		// Release all terminals
		this.releaseAll().catch((err) => {
			Logger.debug("[AcpTerminalManager] Error releasing terminals:", err)
		})

		// Clear all tracking
		this.terminals.clear()
		this.numericIdToStringId.clear()
		this.processes.clear()
		this.terminalInfos.clear()

		Logger.debug("[AcpTerminalManager] disposeAll complete")
	}

	/**
	 * Set the timeout for waiting for shell integration.
	 * @param timeout Timeout in milliseconds
	 */
	setShellIntegrationTimeout(_timeout: number): void {
		// no-op
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
	 */
	setDefaultTerminalProfile(_profile: string): void {
		// no-op
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

	// =========================================================================
	// ACP-specific Methods (original interface)
	// =========================================================================

	/**
	 * Check if the client supports terminal operations.
	 */
	canUseTerminal(): boolean {
		return this.clientCapabilities?.terminal === true
	}

	/**
	 * Create a new terminal and execute a command.
	 *
	 * @param options - Terminal creation options
	 * @returns The managed terminal instance or an error
	 */
	async createTerminal(options: CreateTerminalOptions): Promise<ManagedTerminal | { error: string }> {
		if (!this.canUseTerminal()) {
			return { error: "Client does not support terminal capability" }
		}

		Logger.debug("[AcpTerminalManager] createTerminal:", options)

		try {
			const request: acp.CreateTerminalRequest = {
				sessionId: this.getSessionId(),
				command: options.command,
			}

			// Add optional parameters if provided
			if (options.args !== undefined && options.args.length > 0) {
				request.args = options.args
			}
			if (options.cwd !== undefined) {
				request.cwd = options.cwd
			}
			if (options.env !== undefined && options.env.length > 0) {
				request.env = options.env.map((e) => ({ name: e.name, value: e.value }))
			}
			if (options.outputByteLimit !== undefined) {
				request.outputByteLimit = options.outputByteLimit
			}

			const handle = await this.connection.createTerminal(request)
			const numericId = this.nextNumericId++

			const managedTerminal: ManagedTerminal = {
				id: handle.id,
				numericId,
				handle,
				command: options.command,
				args: options.args,
				cwd: options.cwd,
				createdAt: Date.now(),
				released: false,
				busy: true,
				lastCommand: options.command,
			}

			this.terminals.set(handle.id, managedTerminal)
			this.numericIdToStringId.set(numericId, handle.id)

			Logger.debug("[AcpTerminalManager] createTerminal success:", { id: handle.id, numericId })

			return managedTerminal
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			Logger.debug("[AcpTerminalManager] createTerminal error:", errorMessage)

			return { error: errorMessage }
		}
	}

	/**
	 * Get the current output of a terminal without waiting for it to exit.
	 *
	 * @param terminalId - The terminal ID (string)
	 * @returns The current output or an error
	 */
	async getOutput(terminalId: string): Promise<TerminalOutputResult> {
		const terminal = this.terminals.get(terminalId)

		if (!terminal) {
			return {
				output: "",
				truncated: false,
				success: false,
				error: `Terminal not found: ${terminalId}`,
			}
		}

		if (terminal.released) {
			return {
				output: "",
				truncated: false,
				success: false,
				error: `Terminal has been released: ${terminalId}`,
			}
		}

		Logger.debug("[AcpTerminalManager] getOutput:", { terminalId })

		try {
			const response = await terminal.handle.currentOutput()

			const result: TerminalOutputResult = {
				output: response.output,
				truncated: response.truncated,
				success: true,
			}

			if (response.exitStatus) {
				result.exitStatus = {
					exitCode: response.exitStatus.exitCode ?? undefined,
					signal: response.exitStatus.signal ?? undefined,
				}
			}

			Logger.debug("[AcpTerminalManager] getOutput response:", {
				outputLength: response.output.length,
				truncated: response.truncated,
				hasExitStatus: !!response.exitStatus,
			})

			return result
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			Logger.debug("[AcpTerminalManager] getOutput error:", errorMessage)

			return {
				output: "",
				truncated: false,
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Wait for a terminal command to exit and return its exit status.
	 *
	 * @param terminalId - The terminal ID (string)
	 * @returns The exit status or an error
	 */
	async waitForExit(terminalId: string): Promise<TerminalWaitResult> {
		const terminal = this.terminals.get(terminalId)

		if (!terminal) {
			return {
				success: false,
				error: `Terminal not found: ${terminalId}`,
			}
		}

		if (terminal.released) {
			return {
				success: false,
				error: `Terminal has been released: ${terminalId}`,
			}
		}

		Logger.debug("[AcpTerminalManager] waitForExit:", { terminalId })

		try {
			const response = await terminal.handle.waitForExit()

			Logger.debug("[AcpTerminalManager] waitForExit response:", response)

			return {
				exitCode: response.exitCode ?? undefined,
				signal: response.signal ?? undefined,
				success: true,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			Logger.debug("[AcpTerminalManager] waitForExit error:", errorMessage)

			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Kill a terminal command without releasing the terminal.
	 *
	 * The terminal remains valid after killing, allowing you to:
	 * - Get the final output with getOutput()
	 * - Check the exit status
	 * - Release the terminal when done
	 *
	 * @param terminalId - The terminal ID (string)
	 * @returns The operation result
	 */
	async kill(terminalId: string): Promise<TerminalOperationResult> {
		const terminal = this.terminals.get(terminalId)

		if (!terminal) {
			return {
				success: false,
				error: `Terminal not found: ${terminalId}`,
			}
		}

		if (terminal.released) {
			return {
				success: false,
				error: `Terminal has been released: ${terminalId}`,
			}
		}

		Logger.debug("[AcpTerminalManager] kill:", { terminalId })

		try {
			await terminal.handle.kill()

			Logger.debug("[AcpTerminalManager] kill success")

			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			Logger.debug("[AcpTerminalManager] kill error:", errorMessage)

			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Release a terminal and free all associated resources.
	 *
	 * If the command is still running, it will be killed.
	 * After release, the terminal ID becomes invalid and cannot be used
	 * with other terminal methods.
	 *
	 * @param terminalId - The terminal ID (string)
	 * @returns The operation result
	 */
	async release(terminalId: string): Promise<TerminalOperationResult> {
		const terminal = this.terminals.get(terminalId)

		if (!terminal) {
			return {
				success: false,
				error: `Terminal not found: ${terminalId}`,
			}
		}

		if (terminal.released) {
			// Already released, consider it a success
			return { success: true }
		}

		Logger.debug("[AcpTerminalManager] release:", { terminalId })

		try {
			await terminal.handle.release()
			terminal.released = true

			Logger.debug("[AcpTerminalManager] release success")

			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			Logger.debug("[AcpTerminalManager] release error:", errorMessage)

			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Get a managed terminal by its string ID.
	 *
	 * @param terminalId - The terminal ID (string)
	 * @returns The managed terminal or undefined
	 */
	getTerminal(terminalId: string): ManagedTerminal | undefined {
		return this.terminals.get(terminalId)
	}

	/**
	 * Get all active (non-released) terminals.
	 */
	getActiveTerminals(): ManagedTerminal[] {
		return Array.from(this.terminals.values()).filter((t) => !t.released)
	}

	/**
	 * Get the count of active terminals.
	 */
	getActiveTerminalCount(): number {
		return this.getActiveTerminals().length
	}

	/**
	 * Release all active terminals.
	 *
	 * This is useful for cleanup when a session ends.
	 */
	async releaseAll(): Promise<void> {
		const activeTerminals = this.getActiveTerminals()

		Logger.debug("[AcpTerminalManager] releaseAll:", { count: activeTerminals.length })

		const releasePromises = activeTerminals.map((terminal) => this.release(terminal.id))
		await Promise.allSettled(releasePromises)

		Logger.debug("[AcpTerminalManager] releaseAll complete")
	}

	/**
	 * Execute a command and wait for it to complete.
	 *
	 * This is a convenience method that creates a terminal, waits for exit,
	 * gets the output, and releases the terminal.
	 *
	 * @param options - Terminal creation options
	 * @returns The output and exit status
	 */
	async executeCommand(
		options: CreateTerminalOptions,
	): Promise<{ output: string; exitCode?: number; signal?: string; success: boolean; error?: string }> {
		const terminalResult = await this.createTerminal(options)

		if ("error" in terminalResult) {
			return {
				output: "",
				success: false,
				error: terminalResult.error,
			}
		}

		const terminal = terminalResult

		try {
			// Wait for the command to exit
			const exitResult = await this.waitForExit(terminal.id)

			if (!exitResult.success) {
				return {
					output: "",
					success: false,
					error: exitResult.error,
				}
			}

			// Get the final output
			const outputResult = await this.getOutput(terminal.id)

			return {
				output: outputResult.output,
				exitCode: exitResult.exitCode,
				signal: exitResult.signal,
				success: true,
			}
		} finally {
			// Always release the terminal
			await this.release(terminal.id)
		}
	}

	/**
	 * Get the current session ID.
	 * @throws Error if session ID is not available
	 */
	private getSessionId(): string {
		const sessionId = this.sessionIdResolver()
		if (!sessionId) {
			throw new Error("Session ID is undefined. Cannot perform terminal operations.")
		}
		return sessionId
	}
}
