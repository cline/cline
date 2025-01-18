import { EventEmitter } from "events"
import stripAnsi from "strip-ansi"
import * as vscode from "vscode"
import { inspect } from "util"
import { ExitCodeDetails } from "./TerminalManager"
import { TerminalRegistry } from "./TerminalRegistry"

export interface TerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: [output?: string]
	error: [error: Error]
	no_shell_integration: []
	/**
	 * Emitted when a shell execution completes
	 * @param id The terminal ID
	 * @param exitDetails Contains exit code and signal information if process was terminated by signal
	 */
	shell_execution_complete: [id: number, exitDetails: ExitCodeDetails]
	stream_available: [id: number, stream: AsyncIterable<string>]
}

// how long to wait after a process outputs anything before we consider it "cool" again
const PROCESS_HOT_TIMEOUT_NORMAL = 2_000
const PROCESS_HOT_TIMEOUT_COMPILING = 15_000

export class TerminalProcess extends EventEmitter<TerminalProcessEvents> {
	waitForShellIntegration: boolean = true
	private isListening: boolean = true
	private buffer: string = ""
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0
	isHot: boolean = false
	private hotTimer: NodeJS.Timeout | null = null

	// constructor() {
	// 	super()

	async run(terminal: vscode.Terminal, command: string) {
		if (terminal.shellIntegration && terminal.shellIntegration.executeCommand) {
			// Get terminal info to access stream
			const terminalInfo = TerminalRegistry.getTerminalInfoByTerminal(terminal)
			if (!terminalInfo) {
				console.error("[TerminalProcess] Terminal not found in registry")
				this.emit("no_shell_integration")
				this.emit("completed")
				this.emit("continue")
				return
			}

			// When executeCommand() is called, onDidStartTerminalShellExecution will fire in TerminalManager
			// which creates a new stream via execution.read() and emits 'stream_available'
			const streamAvailable = new Promise<AsyncIterable<string>>((resolve) => {
				this.once("stream_available", (id: number, stream: AsyncIterable<string>) => {
					if (id === terminalInfo.id) {
						resolve(stream)
					}
				})
			})

			// Create promise that resolves when shell execution completes for this terminal
			const shellExecutionComplete = new Promise<ExitCodeDetails>((resolve) => {
				this.once("shell_execution_complete", (id: number, exitDetails: ExitCodeDetails) => {
					if (id === terminalInfo.id) {
						resolve(exitDetails)
					}
				})
			})

			// Execute command
			terminal.shellIntegration.executeCommand(command)
			this.isHot = true

			// Wait for stream to be available
			const stream = await streamAvailable

			let didEmitEmptyLine = false
			let output = ""

			// Process stream data
			for await (let data of stream) {
				output += data

				// console.log("[Terminal Process] raw chunk: " + inspect(data, { colors: false, breakLength: Infinity }))

				// remove vscode/ansi escapes for streaming pretty-prints, but
				// final output extraction happens below this loop:
				data = data.replace(/\x1b\]633;[^\x07]+\x07/gs, "")
				data = stripAnsi(data)

				// console.log("[Terminal Process] stripped chunk: " + inspect(data, { colors: false, breakLength: Infinity }))

				// Set to hot to stall API requests until terminal is cool again
				this.isHot = true
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
				}
				// these markers indicate the command is some kind of local dev server recompiling the app, which we want to wait for output of before sending request to cline
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
				this.hotTimer = setTimeout(
					() => {
						this.isHot = false
					},
					isCompiling ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL,
				)

				// For non-immediately returning commands we want to show loading spinner right away but this wouldnt happen until it emits a line break, so as soon as we get any output we emit "" to let webview know to show spinner
				if (!didEmitEmptyLine && data) {
					this.emit("line", "") // empty line to indicate start of command output stream
					didEmitEmptyLine = true
				}

				this.fullOutput += data
				if (this.isListening) {
					this.emitIfEol(data)
					this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
				}
			}

			// Wait for shell execution to complete and handle exit details
			const exitDetails = await shellExecutionComplete
			this.isHot = false

			// console.debug("[Terminal Process] raw output: " + inspect(output, { colors: false, breakLength: Infinity }))

			/*
			 * Extract clean output from raw accumulated output. FYI:
			 * ]633 is a custom sequence number used by VSCode shell integration:
			 * - OSC 633 ; A ST - Mark prompt start
			 * - OSC 633 ; B ST - Mark prompt end
			 * - OSC 633 ; C ST - Mark pre-execution (start of command output)
			 * - OSC 633 ; D [; <exitcode>] ST - Mark execution finished with optional exit code
			 * - OSC 633 ; E ; <commandline> [; <nonce>] ST - Explicitly set command line with optional nonce
			 */

			let match: string | undefined
			let matchSource: "VSCE" | "fallback" | undefined

			/*
			* Try patterns in sequence, matching terminal handler order

			* Use string index matching instead of regex for performance because
			* benchmarking shows it is at least 500x faster for large terminal outputs
			*/

			// Pattern 1: Basic command completion (VSCE)
			match = this.stringIndexMatch(output, "\x1b]633;C\x07", "\x1b]633;D")
			if (match !== undefined) {
				matchSource = "VSCE"
			}

			// Pattern 2: Fallback pattern
			if (match === undefined) {
				match = this.stringIndexMatch(
					output,
					"\x1b]633;C\x07",

					// match until the end, for when VSCode bug#237208 drops '\x1b]633;D'
					undefined,
				)
				if (match !== undefined) {
					matchSource = "fallback"
				}
			}

			if (match !== undefined) {
				output = match
			} else {
				console.warn("Terminal output escape sequence match failed. Using unfiltered result. See VSCode bug#237208")
			}

			output = stripAnsi(output)
			// console.debug(`[Terminal Process] processed output via ${matchSource}: ` + inspect(output, { colors: false, breakLength: Infinity }))

			this.emit("line", output)

			// do these matter?
			this.buffer = ""
			this.fullOutput = output

			// for now we don't want this delaying requests since we don't send diagnostics automatically anymore (previous: "even though the command is finished, we still want to consider it 'hot' in case so that api request stalls to let diagnostics catch up")
			if (this.hotTimer) {
				clearTimeout(this.hotTimer)
			}
			this.isHot = false

			this.emit("completed", output)
			this.emit("continue")
		} else {
			terminal.sendText(command, true)
			// For terminals without shell integration, we can't know when the command completes
			// So we'll just emit the continue event after a delay
			this.emit("completed")
			this.emit("continue")
			this.emit("no_shell_integration")
			// setTimeout(() => {
			// 	console.log(`Emitting continue after delay for terminal`)
			// 	// can't emit completed since we don't if the command actually completed, it could still be running server
			// }, 500) // Adjust this delay as needed
		}
	}

	// Inspired by https://github.com/sindresorhus/execa/blob/main/lib/transform/split.js
	private emitIfEol(chunk: string) {
		this.buffer += chunk
		let lineEndIndex: number
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			let line = this.buffer.slice(0, lineEndIndex).trimEnd() // removes trailing \r
			// Remove \r if present (for Windows-style line endings)
			// if (line.endsWith("\r")) {
			// 	line = line.slice(0, -1)
			// }
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	private emitRemainingBufferIfListening() {
		if (this.buffer && this.isListening) {
			const remainingBuffer = this.removeLastLineArtifacts(this.buffer)
			if (remainingBuffer) {
				this.emit("line", remainingBuffer)
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	continue() {
		this.emitRemainingBufferIfListening()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return this.removeLastLineArtifacts(unretrieved)
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

	private stringIndexMatch(data: string, prefix: string, suffix?: string): string | undefined {
		let startIndex: number
		let endIndex: number
		let prefixLength: number

		if (prefix === undefined) {
			startIndex = 0
			prefixLength = 0
		} else {
			startIndex = data.indexOf(prefix)
			if (startIndex === -1) {
				return undefined
			}
			prefixLength = prefix.length
		}

		const contentStart = startIndex + prefixLength

		if (suffix === undefined) {
			// When suffix is undefined, match to end
			endIndex = data.length
		} else {
			endIndex = data.indexOf(suffix, contentStart)
			if (endIndex === -1) {
				return undefined
			}
		}
		return data.slice(contentStart, endIndex)
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
