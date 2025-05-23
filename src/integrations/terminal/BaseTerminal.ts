import { truncateOutput, applyRunLengthEncoding, processBackspaces, processCarriageReturns } from "../misc/extract-text"

import type {
	RooTerminalProvider,
	RooTerminal,
	RooTerminalCallbacks,
	RooTerminalProcess,
	RooTerminalProcessResultPromise,
	ExitCodeDetails,
} from "./types"

export abstract class BaseTerminal implements RooTerminal {
	public readonly provider: RooTerminalProvider
	public readonly id: number
	public readonly initialCwd: string

	public busy: boolean
	public running: boolean
	protected streamClosed: boolean

	public taskId?: string
	public process?: RooTerminalProcess
	public completedProcesses: RooTerminalProcess[] = []

	constructor(provider: RooTerminalProvider, id: number, cwd: string) {
		this.provider = provider
		this.id = id
		this.initialCwd = cwd
		this.busy = false
		this.running = false
		this.streamClosed = false
	}

	public getCurrentWorkingDirectory(): string {
		return this.initialCwd
	}

	abstract isClosed(): boolean

	abstract runCommand(command: string, callbacks: RooTerminalCallbacks): RooTerminalProcessResultPromise

	/**
	 * Sets the active stream for this terminal and notifies the process
	 * @param stream The stream to set, or undefined to clean up
	 * @throws Error if process is undefined when a stream is provided
	 */
	public setActiveStream(stream: AsyncIterable<string> | undefined, pid?: number): void {
		if (stream) {
			if (!this.process) {
				this.running = false

				console.warn(
					`[Terminal ${this.provider}/${this.id}] process is undefined, so cannot set terminal stream (probably user-initiated non-Roo command)`,
				)

				return
			}

			this.running = true
			this.streamClosed = false
			this.process.emit("shell_execution_started", pid)
			this.process.emit("stream_available", stream)
		} else {
			this.streamClosed = true
		}
	}

	/**
	 * Handles shell execution completion for this terminal.
	 * @param exitDetails The exit details of the shell execution
	 */
	public shellExecutionComplete(exitDetails: ExitCodeDetails) {
		this.busy = false
		this.running = false

		if (this.process) {
			// Add to the front of the queue (most recent first).
			if (this.process.hasUnretrievedOutput()) {
				this.completedProcesses.unshift(this.process)
			}

			this.process.emit("shell_execution_complete", exitDetails)
			this.process = undefined
		}
	}

	public get isStreamClosed(): boolean {
		return this.streamClosed
	}

	/**
	 * Gets the last executed command
	 * @returns The last command string or empty string if none
	 */
	public getLastCommand(): string {
		// Return the command from the active process or the most recent process in the queue
		if (this.process) {
			return this.process.command || ""
		} else if (this.completedProcesses.length > 0) {
			return this.completedProcesses[0].command || ""
		}

		return ""
	}

	/**
	 * Cleans the process queue by removing processes that no longer have unretrieved output
	 * or don't belong to the current task
	 */
	public cleanCompletedProcessQueue(): void {
		// Keep only processes with unretrieved output
		this.completedProcesses = this.completedProcesses.filter((process) => process.hasUnretrievedOutput())
	}

	/**
	 * Gets all processes with unretrieved output
	 * @returns Array of processes with unretrieved output
	 */
	public getProcessesWithOutput(): RooTerminalProcess[] {
		// Clean the queue first to remove any processes without output
		this.cleanCompletedProcessQueue()
		return [...this.completedProcesses]
	}

	/**
	 * Gets all unretrieved output from both active and completed processes
	 * @returns Combined unretrieved output from all processes
	 */
	public getUnretrievedOutput(): string {
		let output = ""

		// First check completed processes to maintain chronological order
		for (const process of this.completedProcesses) {
			const processOutput = process.getUnretrievedOutput()

			if (processOutput) {
				output += processOutput
			}
		}

		// Then check active process for most recent output
		const activeOutput = this.process?.getUnretrievedOutput()

		if (activeOutput) {
			output += activeOutput
		}

		this.cleanCompletedProcessQueue()
		return output
	}

	public static defaultShellIntegrationTimeout = 5_000
	private static shellIntegrationTimeout: number = BaseTerminal.defaultShellIntegrationTimeout
	private static shellIntegrationDisabled: boolean = false
	private static commandDelay: number = 0
	private static powershellCounter: boolean = false
	private static terminalZshClearEolMark: boolean = true
	private static terminalZshOhMy: boolean = false
	private static terminalZshP10k: boolean = false
	private static terminalZdotdir: boolean = false
	private static compressProgressBar: boolean = true

	/**
	 * Compresses terminal output by applying run-length encoding and truncating to line limit
	 * @param input The terminal output to compress
	 * @returns The compressed terminal output
	 */
	public static setShellIntegrationTimeout(timeoutMs: number): void {
		BaseTerminal.shellIntegrationTimeout = timeoutMs
	}

	public static getShellIntegrationTimeout(): number {
		return BaseTerminal.shellIntegrationTimeout
	}

	public static setShellIntegrationDisabled(disabled: boolean): void {
		BaseTerminal.shellIntegrationDisabled = disabled
	}

	public static getShellIntegrationDisabled(): boolean {
		return BaseTerminal.shellIntegrationDisabled
	}

	/**
	 * Sets the command delay in milliseconds
	 * @param delayMs The delay in milliseconds
	 */
	public static setCommandDelay(delayMs: number): void {
		BaseTerminal.commandDelay = delayMs
	}

	/**
	 * Gets the command delay in milliseconds
	 * @returns The command delay in milliseconds
	 */
	public static getCommandDelay(): number {
		return BaseTerminal.commandDelay
	}

	/**
	 * Sets whether to use the PowerShell counter workaround
	 * @param enabled Whether to enable the PowerShell counter workaround
	 */
	public static setPowershellCounter(enabled: boolean): void {
		BaseTerminal.powershellCounter = enabled
	}

	/**
	 * Gets whether to use the PowerShell counter workaround
	 * @returns Whether the PowerShell counter workaround is enabled
	 */
	public static getPowershellCounter(): boolean {
		return BaseTerminal.powershellCounter
	}

	/**
	 * Sets whether to clear the ZSH EOL mark
	 * @param enabled Whether to clear the ZSH EOL mark
	 */
	public static setTerminalZshClearEolMark(enabled: boolean): void {
		BaseTerminal.terminalZshClearEolMark = enabled
	}

	/**
	 * Gets whether to clear the ZSH EOL mark
	 * @returns Whether the ZSH EOL mark clearing is enabled
	 */
	public static getTerminalZshClearEolMark(): boolean {
		return BaseTerminal.terminalZshClearEolMark
	}

	/**
	 * Sets whether to enable Oh My Zsh shell integration
	 * @param enabled Whether to enable Oh My Zsh shell integration
	 */
	public static setTerminalZshOhMy(enabled: boolean): void {
		BaseTerminal.terminalZshOhMy = enabled
	}

	/**
	 * Gets whether Oh My Zsh shell integration is enabled
	 * @returns Whether Oh My Zsh shell integration is enabled
	 */
	public static getTerminalZshOhMy(): boolean {
		return BaseTerminal.terminalZshOhMy
	}

	/**
	 * Sets whether to enable Powerlevel10k shell integration
	 * @param enabled Whether to enable Powerlevel10k shell integration
	 */
	public static setTerminalZshP10k(enabled: boolean): void {
		BaseTerminal.terminalZshP10k = enabled
	}

	/**
	 * Gets whether Powerlevel10k shell integration is enabled
	 * @returns Whether Powerlevel10k shell integration is enabled
	 */
	public static getTerminalZshP10k(): boolean {
		return BaseTerminal.terminalZshP10k
	}

	/**
	 * Compresses terminal output by applying run-length encoding and truncating to line limit
	 * @param input The terminal output to compress
	 * @returns The compressed terminal output
	 */
	public static compressTerminalOutput(input: string, lineLimit: number): string {
		let processedInput = input

		if (BaseTerminal.compressProgressBar) {
			processedInput = processCarriageReturns(processedInput)
			processedInput = processBackspaces(processedInput)
		}

		return truncateOutput(applyRunLengthEncoding(processedInput), lineLimit)
	}

	/**
	 * Sets whether to enable ZDOTDIR handling for zsh
	 * @param enabled Whether to enable ZDOTDIR handling
	 */
	public static setTerminalZdotdir(enabled: boolean): void {
		BaseTerminal.terminalZdotdir = enabled
	}

	/**
	 * Gets whether ZDOTDIR handling is enabled
	 * @returns Whether ZDOTDIR handling is enabled
	 */
	public static getTerminalZdotdir(): boolean {
		return BaseTerminal.terminalZdotdir
	}

	/**
	 * Sets whether to compress progress bar output by processing carriage returns
	 * @param enabled Whether to enable progress bar compression
	 */
	public static setCompressProgressBar(enabled: boolean): void {
		BaseTerminal.compressProgressBar = enabled
	}

	/**
	 * Gets whether progress bar compression is enabled
	 * @returns Whether progress bar compression is enabled
	 */
	public static getCompressProgressBar(): boolean {
		return BaseTerminal.compressProgressBar
	}
}
