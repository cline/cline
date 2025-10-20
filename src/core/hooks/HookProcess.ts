import { ChildProcess, spawn } from "child_process"
import { EventEmitter } from "events"

/**
 * HookProcess manages the execution of a hook script with streaming output capabilities.
 * Similar to StandaloneTerminalProcess but specialized for hook execution.
 *
 * Key features:
 * - Real-time stdout/stderr streaming via line events
 * - Separate handling of visual output vs. JSON response
 * - 30-second execution timeout
 * - Hot state tracking (actively outputting)
 * - Process lifecycle management
 */
export class HookProcess extends EventEmitter {
	private childProcess: ChildProcess | null = null
	private buffer = ""
	private fullOutput = ""
	private lastRetrievedIndex = 0
	private isHot = false
	private hotTimer: NodeJS.Timeout | null = null
	private exitCode: number | null = null
	private isCompleted = false
	private timeoutHandle: NodeJS.Timeout | null = null

	// Separate buffers for stdout and stderr
	private stdoutBuffer = ""
	private stderrBuffer = ""

	constructor(
		private readonly scriptPath: string,
		private readonly timeoutMs: number = 30000,
		private readonly abortSignal?: AbortSignal,
	) {
		super()
	}

	/**
	 * Execute the hook script with the given JSON input
	 * @param inputJson The JSON string to pass to the hook via stdin
	 */
	async run(inputJson: string): Promise<void> {
		return new Promise((resolve, reject) => {
			// Check if already aborted
			if (this.abortSignal?.aborted) {
				reject(new Error("Hook execution cancelled"))
				return
			}

			// Set up abort handler
			const abortHandler = () => {
				if (this.childProcess && !this.isCompleted) {
					this.childProcess.kill("SIGTERM")
					reject(new Error("Hook execution cancelled by user"))
				}
			}

			if (this.abortSignal) {
				this.abortSignal.addEventListener("abort", abortHandler)
			}

			// Spawn the hook process
			this.childProcess = spawn(this.scriptPath, [], {
				stdio: ["pipe", "pipe", "pipe"],
				shell: process.platform === "win32",
			})

			let didEmitEmptyLine = false

			// Set up timeout
			this.timeoutHandle = setTimeout(() => {
				if (this.childProcess && !this.isCompleted) {
					this.childProcess.kill("SIGTERM")
					reject(
						new Error(
							`Hook execution timed out after ${this.timeoutMs}ms. The hook script at '${this.scriptPath}' took too long to complete.`,
						),
					)
				}
			}, this.timeoutMs)

			// Handle stdout
			this.childProcess.stdout?.on("data", (data) => {
				const output = data.toString()
				this.stdoutBuffer += output
				this.handleOutput(output, didEmitEmptyLine, "stdout")
				if (!didEmitEmptyLine && output) {
					this.emit("line", "", "stdout") // Signal start of output
					didEmitEmptyLine = true
				}
			})

			// Handle stderr
			this.childProcess.stderr?.on("data", (data) => {
				const output = data.toString()
				this.stderrBuffer += output
				this.handleOutput(output, didEmitEmptyLine, "stderr")
				if (!didEmitEmptyLine && output) {
					this.emit("line", "", "stderr") // Signal start of output
					didEmitEmptyLine = true
				}
			})

			// Handle process completion
			this.childProcess.on("close", (code, signal) => {
				this.exitCode = code
				this.isCompleted = true
				this.emitRemainingBuffer()

				// Clear timers
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
					this.isHot = false
				}
				if (this.timeoutHandle) {
					clearTimeout(this.timeoutHandle)
					this.timeoutHandle = null
				}

				// Remove abort listener
				if (this.abortSignal) {
					this.abortSignal.removeEventListener("abort", abortHandler)
				}

				this.emit("completed", code, signal)

				if (code === 0) {
					resolve()
				} else {
					reject(new Error(`Hook exited with code ${code}${signal ? `, signal ${signal}` : ""}`))
				}
			})

			// Handle process errors
			this.childProcess.on("error", (error) => {
				if (this.timeoutHandle) {
					clearTimeout(this.timeoutHandle)
					this.timeoutHandle = null
				}
				// Remove abort listener
				if (this.abortSignal) {
					this.abortSignal.removeEventListener("abort", abortHandler)
				}
				this.emit("error", error)
				reject(error)
			})

			// Send input to the process
			try {
				this.childProcess.stdin?.write(inputJson)
				this.childProcess.stdin?.end()
			} catch (error) {
				reject(new Error(`Failed to write input to hook: ${error}`))
			}
		})
	}

	/**
	 * Handle output data and emit line events
	 */
	private handleOutput(data: string, _didEmitEmptyLine: boolean, stream: "stdout" | "stderr"): void {
		// Set process as hot (actively outputting)
		this.isHot = true
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}

		// Use a shorter hot timeout for hooks since they typically complete quickly
		const hotTimeout = 1000 // 1 second
		this.hotTimer = setTimeout(() => {
			this.isHot = false
		}, hotTimeout)

		// Store full output
		this.fullOutput += data

		// Emit lines immediately
		this.emitLines(data, stream)
	}

	/**
	 * Emit complete lines from buffered output
	 */
	private emitLines(chunk: string, stream: "stdout" | "stderr"): void {
		this.buffer += chunk
		let lineEndIndex
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, lineEndIndex).trimEnd()
			this.emit("line", line, stream)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
		this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
	}

	/**
	 * Emit any remaining buffered output when process completes
	 */
	private emitRemainingBuffer(): void {
		if (this.buffer) {
			const remainingBuffer = this.buffer.trimEnd()
			if (remainingBuffer) {
				// Determine which stream this came from based on content
				// This is a fallback; in practice, line events should capture most output
				this.emit("line", remainingBuffer, "stdout")
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	/**
	 * Get unretrieved output (for compatibility with terminal process interface)
	 */
	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return unretrieved.trimEnd()
	}

	/**
	 * Check if process is actively outputting
	 */
	isProcessHot(): boolean {
		return this.isHot
	}

	/**
	 * Get the complete stdout buffer (for JSON parsing)
	 */
	getStdout(): string {
		return this.stdoutBuffer
	}

	/**
	 * Get the complete stderr buffer (for error reporting)
	 */
	getStderr(): string {
		return this.stderrBuffer
	}

	/**
	 * Get the exit code
	 */
	getExitCode(): number | null {
		return this.exitCode
	}

	/**
	 * Check if process has completed
	 */
	hasCompleted(): boolean {
		return this.isCompleted
	}

	/**
	 * Terminate the process if still running
	 */
	terminate(): void {
		if (this.childProcess && !this.isCompleted) {
			this.childProcess.kill("SIGTERM")

			// Force kill after timeout
			setTimeout(() => {
				if (!this.isCompleted && this.childProcess) {
					this.childProcess.kill("SIGKILL")
				}
			}, 5000)
		}

		// Clear timeout
		if (this.timeoutHandle) {
			clearTimeout(this.timeoutHandle)
			this.timeoutHandle = null
		}
	}
}
