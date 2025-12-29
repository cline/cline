/**
 * StandaloneTerminalProcess - Manages command execution in standalone environments.
 *
 * This class handles subprocess management for terminal commands when running
 * outside of VSCode (CLI, JetBrains). It spawns child processes and streams
 * their output through events.
 *
 * Implements ITerminalProcess interface for polymorphic usage with CommandExecutor.
 */

import { telemetryService } from "@services/telemetry"
import { ChildProcess, spawn } from "child_process"
import { EventEmitter } from "events"
import { terminateProcessTree } from "@/utils/process-termination"

import {
	isCompilingOutput,
	MAX_FULL_OUTPUT_SIZE,
	MAX_UNRETRIEVED_LINES,
	PROCESS_HOT_TIMEOUT_COMPILING,
	PROCESS_HOT_TIMEOUT_NORMAL,
	TRUNCATE_KEEP_LINES,
} from "../constants"
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
				// Spawn the process with detached: true to create a process group
				// This allows us to kill the entire process tree when terminating
				this.childProcess = spawn(shell, shellArgs, {
					...shellOptions,
					detached: true,
				})
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
			this.childProcess.on("close", (code: number | null, _signal: NodeJS.Signals | null) => {
				this.exitCode = code
				this.isCompleted = true
				this.emitRemainingBuffer()

				// Clear hot timer
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
					this.isHot = false
				}

				// Track terminal execution telemetry
				const success = code === 0 || code === null
				telemetryService.captureTerminalExecution(success, "standalone", "child_process")

				this.emit("completed")
				this.emit("continue")
			})

			// Handle process errors
			this.childProcess.on("error", (error: Error) => {
				// Track terminal execution error telemetry
				telemetryService.captureTerminalExecution(false, "standalone", "child_process_error")
				this.emit("error", error)
			})

			// Update terminal's process reference
			;(terminal as any)._process = this.childProcess
			;(terminal as any)._processId = this.childProcess.pid
		} catch (error) {
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
		const isCompiling = isCompilingOutput(data)
		const hotTimeout = isCompiling ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL
		this.hotTimer = setTimeout(() => {
			this.isHot = false
		}, hotTimeout)

		// Store full output with size cap to prevent memory exhaustion
		this.fullOutput += data

		// Cap fullOutput at MAX_FULL_OUTPUT_SIZE to prevent memory exhaustion
		if (this.fullOutput.length > MAX_FULL_OUTPUT_SIZE) {
			// Keep last half of max size
			this.fullOutput = this.fullOutput.slice(-MAX_FULL_OUTPUT_SIZE / 2)
			// Reset lastRetrievedIndex since we truncated the beginning
			this.lastRetrievedIndex = 0
		}

		if (this.isListening) {
			this.emitLines(data)
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
	 * Emits "continue" event but keeps emitting "line" events for background tracking.
	 *
	 * Note: We intentionally do NOT call removeAllListeners("line") or set isListening=false
	 * because background command tracking needs to continue receiving output lines
	 * after the user clicks "Proceed While Running".
	 */
	continue(): void {
		this.emitRemainingBuffer()
		// Keep isListening = true so we continue emitting "line" events
		// This is needed for background command tracking to log output to file
		this.emit("continue")
	}

	/**
	 * Get output that hasn't been retrieved yet.
	 * Truncates if output is too large to prevent context window overflow.
	 * @returns The unretrieved output (truncated if necessary)
	 */
	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length

		// Truncate if too many lines to prevent context overflow
		const lines = unretrieved.split("\n")
		if (lines.length > MAX_UNRETRIEVED_LINES) {
			const first = lines.slice(0, TRUNCATE_KEEP_LINES)
			const last = lines.slice(-TRUNCATE_KEEP_LINES)
			const skipped = lines.length - first.length - last.length
			return this.removeLastLineArtifacts([...first, `\n... (${skipped} lines truncated) ...\n`, ...last].join("\n"))
		}

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
	 * Terminate the process and all its children.
	 *
	 * Uses terminateProcessTree utility which handles:
	 * - Cross-platform process tree termination via tree-kill
	 * - Graceful shutdown with SIGTERM
	 * - SIGKILL fallback after 2 second timeout
	 */
	async terminate(): Promise<void> {
		if (!this.childProcess || this.isCompleted) {
			return
		}

		const pid = this.childProcess.pid
		if (!pid) {
			// Fallback: try to kill the process directly if PID is unavailable
			this.childProcess.kill("SIGTERM")
			return
		}

		await terminateProcessTree({
			pid,
			childProcess: this.childProcess,
			isCompleted: () => this.isCompleted,
		})
	}
}
