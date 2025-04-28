import { execa, ExecaError } from "execa"

import type { RooTerminal } from "./types"
import { BaseTerminalProcess } from "./BaseTerminalProcess"

export class ExecaTerminalProcess extends BaseTerminalProcess {
	private terminalRef: WeakRef<RooTerminal>
	private controller?: AbortController

	constructor(terminal: RooTerminal) {
		super()

		this.terminalRef = new WeakRef(terminal)
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
		this.controller = new AbortController()

		try {
			this.isHot = true

			const subprocess = execa({
				shell: true,
				cwd: this.terminal.getCurrentWorkingDirectory(),
				cancelSignal: this.controller.signal,
			})`${command}`

			this.terminal.setActiveStream(subprocess)
			this.emit("line", "")

			for await (const line of subprocess) {
				this.fullOutput += `${line}\n`

				const now = Date.now()

				if (this.isListening && (now - this.lastEmitTime_ms > 250 || this.lastEmitTime_ms === 0)) {
					this.emitRemainingBufferIfListening()
					this.lastEmitTime_ms = now
				}

				this.startHotTimer(line)
			}

			this.emit("shell_execution_complete", { exitCode: 0 })
		} catch (error) {
			if (error instanceof ExecaError) {
				console.error(`[ExecaTerminalProcess] shell execution error: ${error.message}`)
				this.emit("shell_execution_complete", {
					exitCode: error.exitCode ?? 1,
					signalName: error.signal,
				})
			} else {
				this.emit("shell_execution_complete", { exitCode: 1 })
			}
		}

		this.terminal.setActiveStream(undefined)
		this.emitRemainingBufferIfListening()
		this.stopHotTimer()
		this.emit("completed", this.fullOutput)
		this.emit("continue")
	}

	public override continue() {
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	public override abort() {
		this.controller?.abort()
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
