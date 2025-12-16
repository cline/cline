import { TerminalOutputFailureReason, telemetryService } from "@services/telemetry"
import { EventEmitter } from "events"
import * as vscode from "vscode"
import { stripAnsi } from "@/hosts/vscode/terminal/ansiUtils"
import { getLatestTerminalOutput } from "@/hosts/vscode/terminal/get-latest-output"
import type { ITerminalProcess, TerminalProcessEvents } from "@/integrations/terminal/types"

// how long to wait after a process outputs anything before we consider it "cool" again
const PROCESS_HOT_TIMEOUT_NORMAL = 2_000
const PROCESS_HOT_TIMEOUT_COMPILING = 15_000

/**
 * VscodeTerminalProcess - Manages command execution in VSCode's integrated terminal.
 *
 * This class handles command execution using VSCode's shell integration API.
 * It processes VSCode-specific escape sequences and streams output through events.
 *
 * Implements ITerminalProcess interface for polymorphic usage with CommandExecutor.
 *
 * Events:
 * - 'line': Emitted for each line of output
 * - 'completed': Emitted when the process completes
 * - 'continue': Emitted when continue() is called
 * - 'error': Emitted on process errors
 * - 'no_shell_integration': Emitted when shell integration is not available
 */
export class VscodeTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	waitForShellIntegration: boolean = true
	private isListening: boolean = true
	private buffer: string = ""
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0
	isHot: boolean = false
	private hotTimer: NodeJS.Timeout | null = null

	async run(terminal: vscode.Terminal, command: string) {
		// When command does not produce any output, we can assume the shell integration API failed and as a fallback return the current terminal contents
		const returnCurrentTerminalContents = async () => {
			try {
				const terminalSnapshot = await getLatestTerminalOutput()
				if (terminalSnapshot && terminalSnapshot.trim()) {
					const fallbackMessage = `The command's output could not be captured due to some technical issue, however it has been executed successfully. Here's the current terminal's content to help you get the command's output:\n\n${terminalSnapshot}`
					this.emit("line", fallbackMessage)
				}
			} catch (error) {
				console.error("Error capturing terminal output:", error)
			}
		}

		if (terminal.shellIntegration && terminal.shellIntegration.executeCommand) {
			// Track that we're using shell integration
			const execution = terminal.shellIntegration.executeCommand(command)
			const stream = execution.read()
			// todo: need to handle errors
			let isFirstChunk = true
			let didOutputNonCommand = false
			let didEmitEmptyLine = false

			for await (let data of stream) {
				// 1. Process chunk and remove artifacts
				if (isFirstChunk) {
					/*
					The first chunk we get from this stream needs to be processed to be more human readable, ie remove vscode's custom escape sequences and identifiers, removing duplicate first char bug, etc.
					*/

					// bug where sometimes the command output makes its way into vscode shell integration metadata
					/*
					]633 is a custom sequence number used by VSCode shell integration:
					- OSC 633 ; A ST - Mark prompt start
					- OSC 633 ; B ST - Mark prompt end
					- OSC 633 ; C ST - Mark pre-execution (start of command output)
					- OSC 633 ; D [; <exitcode>] ST - Mark execution finished with optional exit code
					- OSC 633 ; E ; <commandline> [; <nonce>] ST - Explicitly set command line with optional nonce
					*/
					// if you print this data you might see something like "eecho hello worldo hello world;5ba85d14-e92a-40c4-b2fd-71525581eeb0]633;C" but this is actually just a bunch of escape sequences, ignore up to the first ;C
					/* ddateb15026-6a64-40db-b21f-2a621a9830f0]633;CTue Sep 17 06:37:04 EDT 2024 % ]633;D;0]633;P;Cwd=/Users/saoud/Repositories/test */
					// Gets output between ]633;C (command start) and ]633;D (command end)
					const outputBetweenSequences = this.removeLastLineArtifacts(
						data.match(/\]633;C([\s\S]*?)\]633;D/)?.[1] || "",
					).trim()

					// Once we've retrieved any potential output between sequences, we can remove everything up to end of the last sequence
					// https://code.visualstudio.com/docs/terminal/shell-integration#_vs-code-custom-sequences-osc-633-st
					const vscodeSequenceRegex = /\x1b\]633;.[^\x07]*\x07/g
					const lastMatch = [...data.matchAll(vscodeSequenceRegex)].pop()
					if (lastMatch && lastMatch.index !== undefined) {
						data = data.slice(lastMatch.index + lastMatch[0].length)
					}
					// Place output back after removing vscode sequences
					if (outputBetweenSequences) {
						data = outputBetweenSequences + "\n" + data
					}
					// remove ansi
					data = stripAnsi(data)
					// Split data by newlines
					const lines = data ? data.split("\n") : []
					// Remove non-human readable characters from the first line
					if (lines.length > 0) {
						lines[0] = lines[0].replace(/[^\x20-\x7E]/g, "")
					}
					// Check for duplicated first character that might be a terminal artifact
					// But skip this check for known syntax characters like {, [, ", etc.
					if (
						lines.length > 0 &&
						lines[0].length >= 2 &&
						lines[0][0] === lines[0][1] &&
						!["[", "{", '"', "'", "<", "("].includes(lines[0][0])
					) {
						lines[0] = lines[0].slice(1)
					}
					// Only remove specific terminal artifacts from line beginnings while preserving JSON syntax
					if (lines.length > 0) {
						// This regex only removes common terminal artifacts (%, $, >, #) and invisible control chars
						// but preserves important syntax chars like {, [, ", etc.
						lines[0] = lines[0].replace(/^[\x00-\x1F%$>#\s]*/, "")
					}
					if (lines.length > 1) {
						lines[1] = lines[1].replace(/^[\x00-\x1F%$>#\s]*/, "")
					}
					// Join lines back
					data = lines.join("\n")
					isFirstChunk = false
				} else {
					data = stripAnsi(data)
				}

				// Ctrl+C detection: if user presses Ctrl+C, treat as command terminated
				if (data.includes("^C") || data.includes("\u0003")) {
					if (this.hotTimer) {
						clearTimeout(this.hotTimer)
					}
					this.isHot = false
					break
				}

				// first few chunks could be the command being echoed back, so we must ignore
				// note this means that 'echo' commands won't work
				if (!didOutputNonCommand) {
					const lines = data.split("\n")
					for (let i = 0; i < lines.length; i++) {
						if (command.includes(lines[i].trim())) {
							lines.splice(i, 1)
							i-- // Adjust index after removal
						} else {
							didOutputNonCommand = true
							break
						}
					}
					data = lines.join("\n")
				}

				// 2. Set isHot depending on the command
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

				// For non-immediately returning commands we want to show loading spinner right away but this wouldn't happen until it emits a line break, so as soon as we get any output we emit "" to let webview know to show spinner
				// This is only done for the sake of unblocking the UI, in case there may be some time before the command emits a full line
				if (!didEmitEmptyLine && !this.fullOutput && data) {
					this.emit("line", "") // empty line to indicate start of command output stream
					didEmitEmptyLine = true
				}

				this.fullOutput += data
				if (this.isListening) {
					this.emitIfEol(data)
					this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
				}
			}

			this.emitRemainingBufferIfListening()

			// the command process is finished, let's check the output to see if we need to use the terminal capture fallback
			if (!this.fullOutput.trim()) {
				// No output captured via shell integration, trying fallback
				telemetryService.captureTerminalOutputFailure(TerminalOutputFailureReason.TIMEOUT)
				await returnCurrentTerminalContents()
				// Check if fallback worked
				const terminalSnapshot = await getLatestTerminalOutput()
				if (terminalSnapshot && terminalSnapshot.trim()) {
					telemetryService.captureTerminalExecution(true, "clipboard")
				} else {
					telemetryService.captureTerminalExecution(false, "none")
				}
			} else {
				// Shell integration worked
				telemetryService.captureTerminalExecution(true, "shell_integration")
			}

			// for now we don't want this delaying requests since we don't send diagnostics automatically anymore (previous: "even though the command is finished, we still want to consider it 'hot' in case so that api request stalls to let diagnostics catch up")
			// to explain this further, before we would send workspace diagnostics automatically with each request, but now we only send new diagnostics after file edits, so there's no need to wait for a bit after commands run to let diagnostics catch up
			if (this.hotTimer) {
				clearTimeout(this.hotTimer)
			}
			this.isHot = false

			this.emit("completed")
			this.emit("continue")
		} else {
			// no shell integration detected, we'll fallback to running the command and capturing the terminal's output after some time
			telemetryService.captureTerminalOutputFailure(TerminalOutputFailureReason.NO_SHELL_INTEGRATION)
			terminal.sendText(command, true)

			// wait 3 seconds for the command to run
			await new Promise((resolve) => setTimeout(resolve, 3000))

			// For terminals without shell integration, also try to capture terminal content
			await returnCurrentTerminalContents()
			// Check if clipboard fallback worked
			const terminalSnapshot = await getLatestTerminalOutput()
			if (terminalSnapshot && terminalSnapshot.trim()) {
				telemetryService.captureTerminalExecution(true, "clipboard")
			} else {
				telemetryService.captureTerminalExecution(false, "none")
			}
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
			const line = this.buffer.slice(0, lineEndIndex).trimEnd() // removes trailing \r
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
}

export type TerminalProcessResultPromise = VscodeTerminalProcess & Promise<void>

// Similar to execa's ResultPromise, this lets us create a mixin of both a TerminalProcess and a Promise: https://github.com/sindresorhus/execa/blob/main/lib/methods/promise.js
export function mergePromise(process: VscodeTerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
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
