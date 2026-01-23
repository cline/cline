/**
 * ACP Terminal Manager for terminal operations delegation.
 *
 * This manager handles terminal lifecycle operations via the ACP client,
 * allowing the editor to manage terminal processes instead of the agent
 * spawning its own processes.
 *
 * @module acp
 */

import type * as acp from "@agentclientprotocol/sdk"
import type { TerminalHandle } from "@agentclientprotocol/sdk"

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
}

/**
 * Manager for terminal operations via the ACP client.
 *
 * This class provides a high-level interface for creating and managing
 * terminals through the ACP protocol, with automatic tracking of
 * terminal instances.
 */
export class AcpTerminalManager {
	private readonly connection: acp.AgentSideConnection
	private readonly clientCapabilities: acp.ClientCapabilities | undefined
	private readonly sessionId: string
	private readonly debug: boolean

	/** Active terminals indexed by their ID */
	private readonly terminals: Map<string, ManagedTerminal> = new Map()

	/**
	 * Creates a new AcpTerminalManager.
	 *
	 * @param connection - The ACP agent-side connection
	 * @param clientCapabilities - The client's advertised capabilities
	 * @param sessionId - The current session ID
	 * @param debug - Whether to enable debug logging
	 */
	constructor(
		connection: acp.AgentSideConnection,
		clientCapabilities: acp.ClientCapabilities | undefined,
		sessionId: string,
		debug: boolean = false,
	) {
		this.connection = connection
		this.clientCapabilities = clientCapabilities
		this.sessionId = sessionId
		this.debug = debug
	}

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

		if (this.debug) {
			console.error("[AcpTerminalManager] createTerminal:", options)
		}

		try {
			const request: acp.CreateTerminalRequest = {
				sessionId: this.sessionId,
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

			const managedTerminal: ManagedTerminal = {
				id: handle.id,
				handle,
				command: options.command,
				args: options.args,
				cwd: options.cwd,
				createdAt: Date.now(),
				released: false,
			}

			this.terminals.set(handle.id, managedTerminal)

			if (this.debug) {
				console.error("[AcpTerminalManager] createTerminal success:", { id: handle.id })
			}

			return managedTerminal
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			if (this.debug) {
				console.error("[AcpTerminalManager] createTerminal error:", errorMessage)
			}

			return { error: errorMessage }
		}
	}

	/**
	 * Get the current output of a terminal without waiting for it to exit.
	 *
	 * @param terminalId - The terminal ID
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

		if (this.debug) {
			console.error("[AcpTerminalManager] getOutput:", { terminalId })
		}

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

			if (this.debug) {
				console.error("[AcpTerminalManager] getOutput response:", {
					outputLength: response.output.length,
					truncated: response.truncated,
					hasExitStatus: !!response.exitStatus,
				})
			}

			return result
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			if (this.debug) {
				console.error("[AcpTerminalManager] getOutput error:", errorMessage)
			}

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
	 * @param terminalId - The terminal ID
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

		if (this.debug) {
			console.error("[AcpTerminalManager] waitForExit:", { terminalId })
		}

		try {
			const response = await terminal.handle.waitForExit()

			if (this.debug) {
				console.error("[AcpTerminalManager] waitForExit response:", response)
			}

			return {
				exitCode: response.exitCode ?? undefined,
				signal: response.signal ?? undefined,
				success: true,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			if (this.debug) {
				console.error("[AcpTerminalManager] waitForExit error:", errorMessage)
			}

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
	 * @param terminalId - The terminal ID
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

		if (this.debug) {
			console.error("[AcpTerminalManager] kill:", { terminalId })
		}

		try {
			await terminal.handle.kill()

			if (this.debug) {
				console.error("[AcpTerminalManager] kill success")
			}

			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			if (this.debug) {
				console.error("[AcpTerminalManager] kill error:", errorMessage)
			}

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
	 * @param terminalId - The terminal ID
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

		if (this.debug) {
			console.error("[AcpTerminalManager] release:", { terminalId })
		}

		try {
			await terminal.handle.release()
			terminal.released = true

			if (this.debug) {
				console.error("[AcpTerminalManager] release success")
			}

			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			if (this.debug) {
				console.error("[AcpTerminalManager] release error:", errorMessage)
			}

			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Get a managed terminal by its ID.
	 *
	 * @param terminalId - The terminal ID
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

		if (this.debug) {
			console.error("[AcpTerminalManager] releaseAll:", { count: activeTerminals.length })
		}

		const releasePromises = activeTerminals.map((terminal) => this.release(terminal.id))
		await Promise.allSettled(releasePromises)

		if (this.debug) {
			console.error("[AcpTerminalManager] releaseAll complete")
		}
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
	 */
	getSessionId(): string {
		return this.sessionId
	}
}
