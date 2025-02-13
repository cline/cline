import { EventEmitter } from "events"
import stripAnsi from "strip-ansi"
import * as vscode from "vscode"
import { inspect } from "util"
import { ExitCodeDetails } from "./TerminalManager"
import { TerminalInfo, TerminalRegistry } from "./TerminalRegistry"

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
	private terminalInfo: TerminalInfo | undefined
	private lastEmitTime_ms: number = 0
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

			// getUnretrievedOutput needs to know if streamClosed, so store this for later
			this.terminalInfo = terminalInfo

			// Execute command
			terminal.shellIntegration.executeCommand(command)
			this.isHot = true

			// Wait for stream to be available
			const stream = await streamAvailable

			let preOutput = ""
			let commandOutputStarted = false

			/*
			 * Extract clean output from raw accumulated output. FYI:
			 * ]633 is a custom sequence number used by VSCode shell integration:
			 * - OSC 633 ; A ST - Mark prompt start
			 * - OSC 633 ; B ST - Mark prompt end
			 * - OSC 633 ; C ST - Mark pre-execution (start of command output)
			 * - OSC 633 ; D [; <exitcode>] ST - Mark execution finished with optional exit code
			 * - OSC 633 ; E ; <commandline> [; <nonce>] ST - Explicitly set command line with optional nonce
			 */

			// Process stream data
			for await (let data of stream) {
				// Check for command output start marker
				if (!commandOutputStarted) {
					preOutput += data
					const match = this.stringIndexMatch(data, "\x1b]633;C\x07", undefined)
					if (match !== undefined) {
						commandOutputStarted = true
						data = match
						this.fullOutput = "" // Reset fullOutput when command actually starts
					} else {
						continue
					}
				}

				// Command output started, accumulate data without filtering.
				// notice to future programmers: do not add escape sequence
				// filtering here: fullOutput cannot change in length (see getUnretrievedOutput),
				// and chunks may not be complete so you cannot rely on detecting or removing escape sequences mid-stream.
				this.fullOutput += data

				// For non-immediately returning commands we want to show loading spinner
				// right away but this wouldnt happen until it emits a line break, so
				// as soon as we get any output we emit to let webview know to show spinner
				const now = Date.now()
				if (this.isListening && (now - this.lastEmitTime_ms > 100 || this.lastEmitTime_ms === 0)) {
					this.emitRemainingBufferIfListening()
					this.lastEmitTime_ms = now
				}

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
			}

			// Set streamClosed immediately after stream ends
			if (this.terminalInfo) {
				this.terminalInfo.streamClosed = true
			}

			// Wait for shell execution to complete and handle exit details
			const exitDetails = await shellExecutionComplete
			this.isHot = false

			if (commandOutputStarted) {
				// Emit any remaining output before completing
				this.emitRemainingBufferIfListening()
			} else {
				console.error(
					"[Terminal Process] VSCE output start escape sequence (]633;C) not received! VSCE Bug? preOutput: " +
						inspect(preOutput, { colors: false, breakLength: Infinity }),
				)
			}

			// console.debug("[Terminal Process] raw output: " + inspect(output, { colors: false, breakLength: Infinity }))

			// fullOutput begins after "\x1b]633;C" so we only need to trim off "\x1b]633;D"
			// (if "D" exists, see VSCode bug# 237208):
			const match = this.stringIndexMatch(preOutput, undefined, "\x1b]633;D")
			if (match !== undefined) {
				this.fullOutput = match
			}

			// console.debug(`[Terminal Process] processed output via ${matchSource}: ` + inspect(output, { colors: false, breakLength: Infinity }))

			// for now we don't want this delaying requests since we don't send diagnostics automatically anymore (previous: "even though the command is finished, we still want to consider it 'hot' in case so that api request stalls to let diagnostics catch up")
			if (this.hotTimer) {
				clearTimeout(this.hotTimer)
			}
			this.isHot = false

			this.emit("completed", this.removeEscapeSequences(this.fullOutput))
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

	private emitRemainingBufferIfListening() {
		if (this.isListening) {
			const remainingBuffer = this.getUnretrievedOutput()
			if (remainingBuffer !== "") {
				this.emit("line", remainingBuffer)
			}
		}
	}

	continue() {
		this.emitRemainingBufferIfListening()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	// Returns complete lines with their carriage returns.
	// The final line may lack a carriage return if the program didn't send one.
	getUnretrievedOutput(): string {
		// Get raw unretrieved output
		let outputToProcess = this.fullOutput.slice(this.lastRetrievedIndex)

		// Check for VSCE command end marker
		let endIndex = outputToProcess.indexOf("\x1b]633;D")

		// If no end marker was found yet (possibly due to VSCode bug#237208):
		//   For active streams: return only complete lines (up to last \n).
		//   For closed streams: return all remaining content.
		if (endIndex === -1) {
			if (!this.terminalInfo?.streamClosed) {
				// Stream still running - only process complete lines
				endIndex = outputToProcess.lastIndexOf("\n")
				if (endIndex === -1) {
					// No complete lines
					return ""
				}

				// Include carriage return
				endIndex++
			} else {
				// Stream closed - process all remaining output
				endIndex = outputToProcess.length
			}
		}

		// Update index and slice output
		this.lastRetrievedIndex += endIndex
		outputToProcess = outputToProcess.slice(0, endIndex)

		// Clean and return output
		return this.removeEscapeSequences(outputToProcess)
	}

	private stringIndexMatch(data: string, prefix?: string, suffix?: string): string | undefined {
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

	// Removes ANSI escape sequences and VSCode-specific terminal control codes from output.
	// While stripAnsi handles most ANSI codes, VSCode's shell integration adds custom
	// escape sequences (OSC 633) that need special handling. These sequences control
	// terminal features like marking command start/end and setting prompts.
	//
	// This method could be extended to handle other escape sequences, but any additions
	// should be carefully considered to ensure they only remove control codes and don't
	// alter the actual content or behavior of the output stream.
	private removeEscapeSequences(str: string): string {
		return stripAnsi(str.replace(/\x1b\]633;[^\x07]+\x07/gs, ""))
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
