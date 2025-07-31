import { execa, ExecaError } from "execa"
import psTree from "ps-tree"
import process from "process"

import type { RooTerminal } from "./types"
import { BaseTerminalProcess } from "./BaseTerminalProcess"

export class ExecaTerminalProcess extends BaseTerminalProcess {
	private terminalRef: WeakRef<RooTerminal>
	private aborted = false
	private pid?: number
	private subprocess?: ReturnType<typeof execa>
	private pidUpdatePromise?: Promise<void>

	constructor(terminal: RooTerminal) {
		super()

		this.terminalRef = new WeakRef(terminal)

		this.once("completed", () => {
			this.terminal.busy = false
		})
	}

	public get terminal(): RooTerminal {
		const terminal = this.terminalRef.deref()

		if (!terminal) {
			throw new Error("Unable to dereference terminal")
		}

		return terminal
	}

	public override async run(command: string) {
		this.command = command

		try {
			this.isHot = true

			this.subprocess = execa({
				shell: true,
				cwd: this.terminal.getCurrentWorkingDirectory(),
				all: true,
				env: {
					...process.env,
					// Ensure UTF-8 encoding for Ruby, CocoaPods, etc.
					LANG: "en_US.UTF-8",
					LC_ALL: "en_US.UTF-8",
				},
			})`${command}`

			this.pid = this.subprocess.pid

			// When using shell: true, the PID is for the shell, not the actual command
			// Find the actual command PID after a small delay
			if (this.pid) {
				this.pidUpdatePromise = new Promise<void>((resolve) => {
					setTimeout(() => {
						psTree(this.pid!, (err, children) => {
							if (!err && children.length > 0) {
								// Update PID to the first child (the actual command)
								const actualPid = parseInt(children[0].PID)
								if (!isNaN(actualPid)) {
									this.pid = actualPid
								}
							}
							resolve()
						})
					}, 100)
				})
			}

			const rawStream = this.subprocess.iterable({ from: "all", preserveNewlines: true })

			// Wrap the stream to ensure all chunks are strings (execa can return Uint8Array)
			const stream = (async function* () {
				for await (const chunk of rawStream) {
					yield typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
				}
			})()

			this.terminal.setActiveStream(stream, this.pid)

			for await (const line of stream) {
				if (this.aborted) {
					break
				}

				this.fullOutput += line

				const now = Date.now()

				if (this.isListening && (now - this.lastEmitTime_ms > 500 || this.lastEmitTime_ms === 0)) {
					this.emitRemainingBufferIfListening()
					this.lastEmitTime_ms = now
				}

				this.startHotTimer(line)
			}

			if (this.aborted) {
				let timeoutId: NodeJS.Timeout | undefined

				const kill = new Promise<void>((resolve) => {
					console.log(`[ExecaTerminalProcess#run] SIGKILL -> ${this.pid}`)

					timeoutId = setTimeout(() => {
						try {
							this.subprocess?.kill("SIGKILL")
						} catch (e) {}

						resolve()
					}, 5_000)
				})

				try {
					await Promise.race([this.subprocess, kill])
				} catch (error) {
					console.log(
						`[ExecaTerminalProcess#run] subprocess termination error: ${error instanceof Error ? error.message : String(error)}`,
					)
				}

				if (timeoutId) {
					clearTimeout(timeoutId)
				}
			}

			this.emit("shell_execution_complete", { exitCode: 0 })
		} catch (error) {
			if (error instanceof ExecaError) {
				console.error(`[ExecaTerminalProcess#run] shell execution error: ${error.message}`)
				this.emit("shell_execution_complete", { exitCode: error.exitCode ?? 0, signalName: error.signal })
			} else {
				console.error(
					`[ExecaTerminalProcess#run] shell execution error: ${error instanceof Error ? error.message : String(error)}`,
				)

				this.emit("shell_execution_complete", { exitCode: 1 })
			}
			this.subprocess = undefined
		}

		this.terminal.setActiveStream(undefined)
		this.emitRemainingBufferIfListening()
		this.stopHotTimer()
		this.emit("completed", this.fullOutput)
		this.emit("continue")
		this.subprocess = undefined
	}

	public override continue() {
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	public override abort() {
		this.aborted = true

		// Function to perform the kill operations
		const performKill = () => {
			// Try to kill using the subprocess object
			if (this.subprocess) {
				try {
					this.subprocess.kill("SIGKILL")
				} catch (e) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill subprocess: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			}

			// Kill the stored PID (which should be the actual command after our update)
			if (this.pid) {
				try {
					process.kill(this.pid, "SIGKILL")
				} catch (e) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill process ${this.pid}: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			}
		}

		// If PID update is in progress, wait for it before killing
		if (this.pidUpdatePromise) {
			this.pidUpdatePromise.then(performKill).catch(() => performKill())
		} else {
			performKill()
		}

		// Continue with the rest of the abort logic
		if (this.pid) {
			// Also check for any child processes
			psTree(this.pid, async (err, children) => {
				if (!err) {
					const pids = children.map((p) => parseInt(p.PID))
					console.error(`[ExecaTerminalProcess#abort] SIGKILL children -> ${pids.join(", ")}`)

					for (const pid of pids) {
						try {
							process.kill(pid, "SIGKILL")
						} catch (e) {
							console.warn(
								`[ExecaTerminalProcess#abort] Failed to send SIGKILL to child PID ${pid}: ${e instanceof Error ? e.message : String(e)}`,
							)
						}
					}
				} else {
					console.error(
						`[ExecaTerminalProcess#abort] Failed to get process tree for PID ${this.pid}: ${err.message}`,
					)
				}
			})
		}
	}

	public override hasUnretrievedOutput() {
		return this.lastRetrievedIndex < this.fullOutput.length
	}

	public override getUnretrievedOutput() {
		let output = this.fullOutput.slice(this.lastRetrievedIndex)
		let index = output.lastIndexOf("\n")

		if (index === -1) {
			return ""
		}

		index++
		this.lastRetrievedIndex += index

		// console.log(
		// 	`[ExecaTerminalProcess#getUnretrievedOutput] fullOutput.length=${this.fullOutput.length} lastRetrievedIndex=${this.lastRetrievedIndex}`,
		// 	output.slice(0, index),
		// )

		return output.slice(0, index)
	}

	private emitRemainingBufferIfListening() {
		if (!this.isListening) {
			return
		}

		const output = this.getUnretrievedOutput()

		if (output !== "") {
			this.emit("line", output)
		}
	}
}
