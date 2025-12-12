/**
 * StandaloneTerminalProcess - Manages command execution in standalone environments.
 *
 * This class handles subprocess management for terminal commands when running
 * outside of VSCode (CLI, JetBrains). It spawns child processes and streams
 * their output through events.
 *
 * Implements ITerminalProcess interface for polymorphic usage with CommandExecutor.
 */

import { ChildProcess, spawn } from "child_process"
import { EventEmitter } from "events"

import type { ITerminal, ITerminalProcess, TerminalProcessEvents } from "../types"

/**
 * Manages the execution of a command in a standalone terminal environment.
 * Extends EventEmitter to provide real-time output streaming.
 *
 * Implements ITerminalProcess for polymorphic usage with CommandExecutor.
 *
 * Events:
 * - 'line': Emitted for each line of output
 * - 'completed': Emitted when the process completes
 * - 'continue': Emitted when continue() is called
 * - 'error': Emitted on process errors
 * - 'no_shell_integration': Emitted for compatibility (never actually emitted in standalone)
 */
export class StandaloneTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	/** We don't need to wait since we control the process directly */
	waitForShellIntegration: boolean = false

	/** Whether we're actively listening for output */
	isListening: boolean = true

	/** Buffer for incomplete lines */
	private buffer: string = ""

	/** Full output captured from the process */
	private fullOutput: string = ""

	/** Index of last retrieved output position */
	private lastRetrievedIndex: number = 0

	/** Whether the process is actively outputting */
	isHot: boolean = false

	/** Timer for tracking hot state */
	private hotTimer: NodeJS.Timeout | null = null

	/** The spawned child process */
	private childProcess: ChildProcess | null = null

	/** Exit code from the process */
	private exitCode: number | null = null

	/** Whether the process has completed */
	private isCompleted: boolean = false

	constructor() {
		super()
	}

	/**
	 * Run a command in the terminal.
	 * @param terminal The terminal instance to run in
	 * @param command The command to execute
	 */
	async run(terminal: ITerminal, command: string): Promise<void> {
		console.log(`[StandaloneTerminal] Running command: ${command}`)

		// Get shell and working directory from terminal
		const shell = (terminal as any)._shellPath || this.getDefaultShell()
		const cwd = (terminal as any)._cwd || process.cwd()

		// Prepare command for execution
		const shellArgs = this.getShellArgs(shell, command)

		try {
			// Create shell options
			const shellOptions: {
				cwd: string
				stdio: ["ignore", "pipe", "pipe"]
				env: NodeJS.ProcessEnv
				shell?: boolean
			} = {
				cwd: cwd,
				stdio: ["ignore", "pipe", "pipe"], // Disable STDIN to prevent interactivity
				env: {
					...process.env,
					TERM: "xterm-256color",
					PAGER: "cat", // Prevent less from being used, reducing interactivity
					EDITOR: process.env.EDITOR || "cat", // Set EDITOR if not already set
					GIT_PAGER: "cat", // Prevent git from using less
					SYSTEMD_PAGER: "", // Disable systemd pager
					MANPAGER: "cat", // Disable man pager
				},
			}

			// Enable the shell option for "cmd.exe" to prevent double quotes from being over escaped
			if (shell.toLowerCase().includes("cmd")) {
				shellOptions.shell = true

				// Spawn the process with special handling for "cmd.exe"
				this.childProcess = spawn("cmd.exe", shellArgs, shellOptions)
			} else {
				// Spawn the process
				this.childProcess = spawn(shell, shellArgs, shellOptions)
			}

			// Track process state
			let didEmitEmptyLine = false

			// Handle stdout
			this.childProcess.stdout?.on("data", (data: Buffer) => {
				const output = data.toString()
				this.handleOutput(output, didEmitEmptyLine)
				if (!didEmitEmptyLine && output) {
					this.emit("line", "") // Signal start of output
					didEmitEmptyLine = true
				}
			})

			// Handle stderr
			this.childProcess.stderr?.on("data", (data: Buffer) => {
				const output = data.toString()
				this.handleOutput(output, didEmitEmptyLine)
				if (!didEmitEmptyLine && output) {
					this.emit("line", "")
					didEmitEmptyLine = true
				}
			})

			// Handle process completion
			this.childProcess.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
				console.log(`[StandaloneTerminal] Process closed with code ${code}, signal ${signal}`)
				this.exitCode = code
				this.isCompleted = true
				this.emitRemainingBuffer()

				// Clear hot timer
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
					this.isHot = false
				}

				this.emit("completed")
				this.emit("continue")
			})

			// Handle process errors
			this.childProcess.on("error", (error: Error) => {
				console.error(`[StandaloneTerminal] Process error:`, error)
				this.emit("error", error)
			})

			// Update terminal's process reference
			;(terminal as any)._process = this.childProcess
			;(terminal as any)._processId = this.childProcess.pid
		} catch (error) {
			console.error(`[StandaloneTerminal] Failed to spawn process:`, error)
			this.emit("error", error)
		}
	}

	/**
	 * Handle output from the process.
	 * @param data The output data
	 * @param _didEmitEmptyLine Whether we've already emitted an empty line
	 */
	private handleOutput(data: string, _didEmitEmptyLine: boolean): void {
		// Set process as hot (actively outputting)
		this.isHot = true
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}

		// Check for compilation markers to adjust hot timeout
		const compilingMarkers = ["compiling", "building", "bundling", "transpiling", "generating", "starting"]
		const markerNullifiers = [
			"compiled",
			"success",
			"finish",
			"complete",
			"succeed",
			"done",
			"end",
			"stop",
			"exit",
			"terminate",
			"error",
			"fail",
		]

		const isCompiling =
			compilingMarkers.some((marker) => data.toLowerCase().includes(marker.toLowerCase())) &&
			!markerNullifiers.some((nullifier) => data.toLowerCase().includes(nullifier.toLowerCase()))

		const hotTimeout = isCompiling ? 15000 : 2000
		this.hotTimer = setTimeout(() => {
			this.isHot = false
		}, hotTimeout)

		// Store full output
		this.fullOutput += data

		if (this.isListening) {
			this.emitLines(data)
			this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
		}
	}

	/**
	 * Emit lines from the buffer.
	 * @param chunk The chunk of data to process
	 */
	private emitLines(chunk: string): void {
		this.buffer += chunk
		let lineEndIndex: number
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, lineEndIndex).trimEnd()
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	/**
	 * Emit any remaining content in the buffer.
	 */
	private emitRemainingBuffer(): void {
		if (this.buffer && this.isListening) {
			const remainingBuffer = this.removeLastLineArtifacts(this.buffer)
			if (remainingBuffer) {
				this.emit("line", remainingBuffer)
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	/**
	 * Continue execution without waiting for completion.
	 * Stops event emission and resolves the promise.
	 */
	continue(): void {
		this.emitRemainingBuffer()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	/**
	 * Get output that hasn't been retrieved yet.
	 * @returns The unretrieved output
	 */
	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return this.removeLastLineArtifacts(unretrieved)
	}

	/**
	 * Remove shell prompt artifacts from the end of output.
	 * @param output The output to clean
	 * @returns Cleaned output
	 */
	private removeLastLineArtifacts(output: string): string {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}

	/**
	 * Get the default shell for the current platform.
	 * @returns The default shell path
	 */
	private getDefaultShell(): string {
		if (process.platform === "win32") {
			return process.env.COMSPEC || "cmd.exe"
		} else {
			return process.env.SHELL || "/bin/bash"
		}
	}

	/**
	 * Get shell arguments for executing a command.
	 * @param shell The shell path
	 * @param command The command to execute
	 * @returns Array of shell arguments
	 */
	private getShellArgs(shell: string, command: string): string[] {
		if (process.platform === "win32") {
			if (shell.toLowerCase().includes("powershell") || shell.toLowerCase().includes("pwsh")) {
				return ["-Command", command]
			} else {
				return ["/c", command]
			}
		} else {
			// Use -l for login shell, -c for command
			return ["-l", "-c", command]
		}
	}

	/**
	 * Terminate the process if it's still running.
	 */
	terminate(): void {
		if (!this.childProcess || this.isCompleted) {
			console.log(`[StandaloneTerminal] Process already completed or doesn't exist, skipping termination`)
			return
		}

		const pid = this.childProcess.pid
		console.log(`[StandaloneTerminal] Terminating process ${pid} with SIGTERM`)

		try {
			this.childProcess.kill("SIGTERM")

			// Force kill after timeout if process doesn't exit gracefully
			setTimeout(() => {
				if (!this.isCompleted && this.childProcess) {
					console.log(`[StandaloneTerminal] Process ${pid} did not exit gracefully, force killing with SIGKILL`)
					try {
						this.childProcess.kill("SIGKILL")
					} catch (killError) {
						console.error(`[StandaloneTerminal] Failed to force kill process ${pid}:`, killError)
					}
				} else {
					console.log(`[StandaloneTerminal] Process ${pid} exited gracefully`)
				}
			}, 5000)
		} catch (error) {
			console.error(`[StandaloneTerminal] Failed to send SIGTERM to process ${pid}:`, error)
			// Try SIGKILL immediately if SIGTERM fails
			try {
				this.childProcess.kill("SIGKILL")
			} catch (killError) {
				console.error(`[StandaloneTerminal] Failed to send SIGKILL to process ${pid}:`, killError)
			}
		}
	}
}
