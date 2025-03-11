import { EventEmitter } from "events"
import { stripAnsi } from "./ansiUtils"
import * as vscode from "vscode"
import { extractTextFromTerminal } from "../../integrations/misc/extract-text"

export interface TerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: []
	error: [error: Error]
	no_shell_integration: []
}

// how long to wait after a process outputs anything before we consider it "cool" again
const PROCESS_HOT_TIMEOUT_NORMAL = 2_000
const PROCESS_HOT_TIMEOUT_COMPILING = 15_000

// how long to wait for command output before timing out
const COMMAND_OUTPUT_TIMEOUT = 5_000

// VSCode shell integration sequences
const SEQUENCE_START = "\x1b]633;" // OSC 633
const SEQUENCE_END = "\x07" // BEL

export class TerminalProcess extends EventEmitter<TerminalProcessEvents> {
	waitForShellIntegration: boolean = true
	private isListening: boolean = true
	private buffer: string = ""
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0
	isHot: boolean = false
	private hotTimer: NodeJS.Timeout | null = null
	private contextLimit: number = 0 // Will be set by run() based on API's context window
	private lastCommand: string = ""

	async run(terminal: vscode.Terminal, command: string, contextLimit: number) {
		this.contextLimit = contextLimit
		this.lastCommand = command
		if (terminal.shellIntegration && terminal.shellIntegration.executeCommand) {
			const execution = terminal.shellIntegration.executeCommand(command)
			const stream = execution.read()
			let didEmitEmptyLine = false
			let foundCommandStart = false
			let lastChunkTime = Date.now()

			for await (const chunk of stream) {
				console.log("[DEBUG] Raw chunk length:", chunk.length)
				console.log("[DEBUG] Raw chunk:", chunk)

				// Remove control sequences
				let data = chunk.replace(/\[\?[0-9]+[a-z]/g, "")
				console.log("[DEBUG] After control sequence removal:", data)

				// Find all sequences
				let sequences = []
				let pos = 0
				while (true) {
					const startPos = data.indexOf(SEQUENCE_START, pos)
					if (startPos === -1) break

					const endPos = data.indexOf(SEQUENCE_END, startPos)
					if (endPos === -1) break

					const sequence = data.slice(startPos + SEQUENCE_START.length, endPos)
					sequences.push({ type: sequence[0], content: sequence.slice(2), start: startPos, end: endPos + 1 })
					pos = endPos + 1
				}

				console.log("[DEBUG] Found sequences:", sequences)

				// Process sequences
				for (const seq of sequences) {
					switch (seq.type) {
						case "C": // Command output start
							if (!foundCommandStart) {
								foundCommandStart = true
								data = data.slice(seq.end)
								lastChunkTime = Date.now()
							}
							break
						case "D": // Command output end
							if (foundCommandStart) {
								data = data.slice(0, seq.start)
							}
							break
					}
				}

				// Skip if we haven't found command start
				if (!foundCommandStart) {
					continue
				}

				// Remove ANSI escape codes
				data = stripAnsi(data)
				console.log("[DEBUG] After ANSI removal:", data)

				// Process lines
				if (this.isListening) {
					// Add to buffer and process lines
					const newBuffer = this.buffer + data
					console.log("[DEBUG] New buffer:", newBuffer)
					this.buffer = newBuffer

					// Process complete lines
					let lineEndIndex: number
					while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
						let line = this.buffer.slice(0, lineEndIndex).trimEnd() // removes trailing \r
						console.log("[DEBUG] Processing line:", line)

						// Clean up line
						line = line.replace(/[^\x20-\x7E]/g, "") // Remove non-printable characters
						line = line.replace(/^[^a-zA-Z0-9]*/, "") // Remove leading non-alphanumeric characters
						line = this.removeLastLineArtifacts(line)

						// Skip command echo and empty lines
						if (line && !command.includes(line.trim())) {
							console.log("[DEBUG] Emitting line:", line)
							this.emit("line", line)
							this.fullOutput += line + "\n"
						}

						this.buffer = this.buffer.slice(lineEndIndex + 1)
					}
				}

				// Check for timeout
				if (Date.now() - lastChunkTime > COMMAND_OUTPUT_TIMEOUT) {
					console.log("[DEBUG] Command output timeout")
					break
				}

				// Stop if we found command end
				if (sequences.some((seq) => seq.type === "D")) {
					break
				}

				lastChunkTime = Date.now()
			}

			// Process any remaining buffer
			if (this.buffer && this.isListening) {
				const line = this.removeLastLineArtifacts(this.buffer)
				if (line && !command.includes(line.trim())) {
					console.log("[DEBUG] Emitting final line:", line)
					this.emit("line", line)
					this.fullOutput += line + "\n"
				}
				this.buffer = ""
			}

			try {
				// Skip empty output
				if (!this.fullOutput.trim()) {
					return
				}

				// Check if output contains compiling markers
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
					compilingMarkers.some((marker) => this.fullOutput.toLowerCase().includes(marker.toLowerCase())) &&
					!markerNullifiers.some((nullifier) => this.fullOutput.toLowerCase().includes(nullifier.toLowerCase()))

				// Set hot state
				this.isHot = true
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
				}
				this.hotTimer = setTimeout(
					() => {
						this.isHot = false
					},
					isCompiling ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL,
				)

				// Check size
				await extractTextFromTerminal(this.fullOutput, this.contextLimit, command)
			} catch (error) {
				this.emit("error", error)
				return
			}

			// for now we don't want this delaying requests since we don't send diagnostics automatically anymore
			if (this.hotTimer) {
				clearTimeout(this.hotTimer)
			}
			this.isHot = false

			this.emit("completed")
			this.emit("continue")
		} else {
			terminal.sendText(command, true)
			// For terminals without shell integration, we can't know when the command completes
			// So we'll just emit the continue event after a delay
			this.emit("completed")
			this.emit("continue")
			this.emit("no_shell_integration")
		}
	}

	continue() {
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	getUnretrievedOutput(): string {
		return this.fullOutput
	}

	// some processing to remove artifacts like '%' at the end of the buffer (it seems that since vsode uses % at the beginning of newlines in terminal, it makes its way into the stream)
	// This modification will remove '%', '$', '#', or '>' followed by optional whitespace
	removeLastLineArtifacts(output: string) {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			// Remove prompt characters and trailing whitespace from the last line
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}
}

export type TerminalProcessResultPromise = TerminalProcess & Promise<void>

// Similar to execa's ResultPromise, this lets us create a mixin of both a TerminalProcess and a Promise: https://github.com/sindresorhus/execa/blob/main/lib/methods/promise.js
export function mergePromise(process: TerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
	const nativePromisePrototype = (async () => {})().constructor.prototype
	const descriptors = ["then", "catch", "finally"].map(
		(property) => [property, Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property)] as const,
	)
	for (const [property, descriptor] of descriptors) {
		if (descriptor) {
			const value = descriptor.value.bind(promise)
			Reflect.defineProperty(process, property, { ...descriptor, value })
		}
	}
	return process as TerminalProcessResultPromise
}
