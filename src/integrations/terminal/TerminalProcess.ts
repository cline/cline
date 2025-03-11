import { EventEmitter } from "events"
import stripAnsi from "strip-ansi"
import * as vscode from "vscode"
import { inspect } from "util"

import { ExitCodeDetails } from "./TerminalManager"
import { TerminalInfo, TerminalRegistry } from "./TerminalRegistry"
import { OutputBuilder } from "./OutputBuilder"

// How long to wait after a process outputs anything before we consider it
// "cool" again
const PROCESS_HOT_TIMEOUT_NORMAL = 2_000
const PROCESS_HOT_TIMEOUT_COMPILING = 15_000

// These markers indicate the command is some kind of local dev server
// recompiling the app, which we want to wait for output of before sending
// request to Roo.
const COMPILE_MARKERS = ["compiling", "building", "bundling", "transpiling", "generating", "starting"]

const COMPILE_MARKER_NULLIFIERS = [
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

const EMIT_INTERVAL = 250

export interface TerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: [output?: string]
	error: [error: Error]
	no_shell_integration: []
	/**
	 * Emitted when a shell execution completes.
	 * @param id The terminal ID
	 * @param exitDetails Contains exit code and signal information if process was terminated by signal
	 */
	shell_execution_complete: [id: number, exitDetails: ExitCodeDetails]
	stream_available: [id: number, stream: AsyncIterable<string>]
	stream_unavailable: [id: number]
	/**
	 * Emitted when an execution fails to emit a "line" event for a given period of time.
	 * @param id The terminal ID
	 */
	stream_stalled: [id: number]
}

export class TerminalProcess extends EventEmitter<TerminalProcessEvents> {
	public waitForShellIntegration = true
	private _isHot = false

	private isListening = true
	private terminalInfo: TerminalInfo | undefined
	private lastEmitAt = 0
	private outputBuilder?: OutputBuilder
	private hotTimer: NodeJS.Timeout | null = null

	public get isHot() {
		return this._isHot
	}

	private set isHot(value: boolean) {
		this._isHot = value
	}

	constructor(
		private readonly terminalOutputLimit: number,
		private readonly stallTimeout: number = 5_000,
	) {
		super()
	}

	async run(terminal: vscode.Terminal, command: string) {
		if (terminal.shellIntegration && terminal.shellIntegration.executeCommand) {
			// Get terminal info to access stream.
			const terminalInfo = TerminalRegistry.getTerminalInfoByTerminal(terminal)

			if (!terminalInfo) {
				console.error("[TerminalProcess#run] terminal not found in registry")
				this.emit("no_shell_integration")
				this.emit("completed")
				this.emit("continue")
				return
			}

			this.once("stream_unavailable", (id: number) => {
				if (id === terminalInfo.id) {
					console.error(`[TerminalProcess#run] stream_unavailable`)
					this.emit("completed")
					this.emit("continue")
				}
			})

			// When `executeCommand()` is called, `onDidStartTerminalShellExecution`
			// will fire in `TerminalManager` which creates a new stream via
			// `execution.read()` and emits `stream_available`.
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

			// `readLine()` needs to know if streamClosed, so store this for later.
			// NOTE: This doesn't seem to be used anywhere.
			this.terminalInfo = terminalInfo

			// Execute command.
			terminal.shellIntegration.executeCommand(command)
			this.isHot = true

			// Wait for stream to be available.
			// const stream = await streamAvailable

			// Wait for stream to be available.
			let stream: AsyncIterable<string>

			try {
				stream = await Promise.race([
					streamAvailable,
					new Promise<never>((_, reject) => {
						setTimeout(
							() => reject(new Error("Timeout waiting for terminal stream to become available")),
							10_000,
						)
					}),
				])
			} catch (error) {
				console.error(`[TerminalProcess#run] timed out waiting for stream`)
				this.emit("stream_stalled", terminalInfo.id)
				stream = await streamAvailable
			}

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

			this.outputBuilder = new OutputBuilder({ maxSize: this.terminalOutputLimit })

			let stallTimer: NodeJS.Timeout | null = setTimeout(() => {
				this.emit("stream_stalled", terminalInfo.id)
			}, this.stallTimeout)

			for await (let data of stream) {
				// Check for command output start marker.
				if (!commandOutputStarted) {
					preOutput += data
					const match = this.matchAfterVsceStartMarkers(data)

					if (match !== undefined) {
						commandOutputStarted = true
						data = match
						this.outputBuilder.reset() // Reset output when command actually starts.
					} else {
						continue
					}
				}

				// Command output started, accumulate data without filtering.
				// Notice to future programmers: do not add escape sequence
				// filtering here: output cannot change in length (see `readLine`),
				// and chunks may not be complete so you cannot rely on detecting or removing escape sequences mid-stream.
				this.outputBuilder.append(data)

				// For non-immediately returning commands we want to show loading spinner
				// right away but this wouldn't happen until it emits a line break, so
				// as soon as we get any output we emit to let webview know to show spinner.
				const now = Date.now()
				const timeSinceLastEmit = now - this.lastEmitAt

				if (this.isListening && timeSinceLastEmit > EMIT_INTERVAL) {
					if (this.flushLine()) {
						if (stallTimer) {
							clearTimeout(stallTimer)
							stallTimer = null
						}

						this.lastEmitAt = now
					}
				}

				// Set isHot depending on the command.
				// This stalls API requests until terminal is cool again.
				this.isHot = true

				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
				}

				const isCompiling =
					COMPILE_MARKERS.some((marker) => data.toLowerCase().includes(marker.toLowerCase())) &&
					!COMPILE_MARKER_NULLIFIERS.some((nullifier) => data.toLowerCase().includes(nullifier.toLowerCase()))

				this.hotTimer = setTimeout(
					() => {
						this.isHot = false
					},
					isCompiling ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL,
				)
			}

			// Set streamClosed immediately after stream ends.
			if (this.terminalInfo) {
				this.terminalInfo.streamClosed = true
			}

			// Wait for shell execution to complete and handle exit details.
			await shellExecutionComplete
			this.isHot = false

			if (commandOutputStarted) {
				// Emit any remaining output before completing.
				this.flushAll()
			} else {
				console.error(
					"[Terminal Process] VSCE output start escape sequence (]633;C or ]133;C) not received! VSCE Bug? preOutput: " +
						inspect(preOutput, { colors: false, breakLength: Infinity }),
				)
			}

			// Output begins after C marker so we only need to trim off D marker
			// (if D exists, see VSCode bug# 237208):
			const match = this.matchBeforeVsceEndMarkers(this.outputBuilder.content)

			if (match !== undefined) {
				this.outputBuilder.reset(match)
			}

			// For now we don't want this delaying requests since we don't send
			// diagnostics automatically anymore (previous: "even though the
			// command is finished, we still want to consider it 'hot' in case
			// so that api request stalls to let diagnostics catch up").
			if (this.hotTimer) {
				clearTimeout(this.hotTimer)
			}

			this.isHot = false

			this.emit("completed", this.removeEscapeSequences(this.outputBuilder.content))
			this.emit("continue")
		} else {
			terminal.sendText(command, true)
			// For terminals without shell integration, we can't know when the command completes.
			// So we'll just emit the continue event.
			this.emit("completed")
			this.emit("continue")
			this.emit("no_shell_integration")
		}
	}

	public readLine() {
		return this.processOutput(this.outputBuilder?.readLine() || "")
	}

	public read() {
		return this.processOutput(this.outputBuilder?.read() || "")
	}

	public continue() {
		console.log(`[TerminalProcess#continue] flushing all`)
		this.flushAll()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	private flushLine() {
		if (!this.isListening) {
			return
		}

		const line = this.readLine()

		if (line) {
			this.emit("line", line)
			return true
		}

		return false
	}

	private flushAll() {
		if (!this.isListening) {
			return
		}

		const buffer = this.read()

		if (buffer) {
			this.emit("line", buffer)
			return true
		}

		return false
	}

	private processOutput(outputToProcess: string) {
		// Check for VSCE command end markers.
		const index633 = outputToProcess.indexOf("\x1b]633;D")
		const index133 = outputToProcess.indexOf("\x1b]133;D")
		let endIndex = -1

		if (index633 !== -1 && index133 !== -1) {
			endIndex = Math.min(index633, index133)
		} else if (index633 !== -1) {
			endIndex = index633
		} else if (index133 !== -1) {
			endIndex = index133
		}

		return this.removeEscapeSequences(endIndex >= 0 ? outputToProcess.slice(0, endIndex) : outputToProcess)
	}

	private stringIndexMatch(
		data: string,
		prefix?: string,
		suffix?: string,
		bell: string = "\x07",
	): string | undefined {
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

			if (bell.length > 0) {
				// Find the bell character after the prefix
				const bellIndex = data.indexOf(bell, startIndex + prefix.length)

				if (bellIndex === -1) {
					return undefined
				}

				const distanceToBell = bellIndex - startIndex
				prefixLength = distanceToBell + bell.length
			} else {
				prefixLength = prefix.length
			}
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
	private removeEscapeSequences(str: string) {
		return stripAnsi(str.replace(/\x1b\]633;[^\x07]+\x07/gs, "").replace(/\x1b\]133;[^\x07]+\x07/gs, ""))
	}

	/**
	 * Helper function to match VSCode shell integration start markers (C).
	 * Looks for content after ]633;C or ]133;C markers.
	 * If both exist, takes the content after the last marker found.
	 */
	private matchAfterVsceStartMarkers(data: string): string | undefined {
		return this.matchVsceMarkers(data, "\x1b]633;C", "\x1b]133;C", undefined, undefined)
	}

	/**
	 * Helper function to match VSCode shell integration end markers (D).
	 * Looks for content before ]633;D or ]133;D markers.
	 * If both exist, takes the content before the first marker found.
	 */
	private matchBeforeVsceEndMarkers(data: string): string | undefined {
		return this.matchVsceMarkers(data, undefined, undefined, "\x1b]633;D", "\x1b]133;D")
	}

	/**
	 * Handles VSCode shell integration markers for command output:
	 *
	 * For C (Command Start):
	 * - Looks for content after ]633;C or ]133;C markers
	 * - These markers indicate the start of command output
	 * - If both exist, takes the content after the last marker found
	 * - This ensures we get the actual command output after any shell integration prefixes
	 *
	 * For D (Command End):
	 * - Looks for content before ]633;D or ]133;D markers
	 * - These markers indicate command completion
	 * - If both exist, takes the content before the first marker found
	 * - This ensures we don't include shell integration suffixes in the output
	 *
	 * In both cases, checks 633 first since it's more commonly used in VSCode shell integration
	 *
	 * @param data The string to search for markers in
	 * @param prefix633 The 633 marker to match after (for C markers)
	 * @param prefix133 The 133 marker to match after (for C markers)
	 * @param suffix633 The 633 marker to match before (for D markers)
	 * @param suffix133 The 133 marker to match before (for D markers)
	 * @returns The content between/after markers, or undefined if no markers found
	 *
	 * Note: Always makes exactly 2 calls to stringIndexMatch regardless of match results.
	 * Using string indexOf matching is ~500x faster than regular expressions, so even
	 * matching twice is still very efficient comparatively.
	 */
	private matchVsceMarkers(
		data: string,
		prefix633: string | undefined,
		prefix133: string | undefined,
		suffix633: string | undefined,
		suffix133: string | undefined,
	): string | undefined {
		// Support both VSCode shell integration markers (633 and 133)
		// Check 633 first since it's more commonly used in VSCode shell integration
		let match133: string | undefined
		const match633 = this.stringIndexMatch(data, prefix633, suffix633)

		// Must check explicitly for undefined because stringIndexMatch can return empty strings
		// that are valid matches (e.g., when a marker exists but has no content between markers)
		if (match633 !== undefined) {
			match133 = this.stringIndexMatch(match633, prefix133, suffix133)
		} else {
			match133 = this.stringIndexMatch(data, prefix133, suffix133)
		}

		return match133 !== undefined ? match133 : match633
	}
}
