import { EventEmitter } from "events"
import { stripAnsi } from "./ansiUtils"
import * as vscode from "vscode"
import { Logger } from "@services/logging/Logger"
import { getLatestTerminalOutput } from "./get-latest-output"

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

export class TerminalProcess extends EventEmitter<TerminalProcessEvents> {
	waitForShellIntegration: boolean = true
	private isListening: boolean = true
	private buffer: string = ""
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0
	isHot: boolean = false
	private hotTimer: NodeJS.Timeout | null = null
	private command: string = ""
	private gracePeriodTimer: NodeJS.Timeout | null = null
	private hasEmittedCompleted: boolean = false

	// constructor() {
	// 	super()

	private async emitCurrentTerminalContents(): Promise<void> {
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

	async run(terminal: vscode.Terminal, command: string) {
		// Initialize state for new command
		await this.initializeForNewCommand(command)

		console.log(`[TerminalProcess] Starting command: "${command}"`)
		console.log(`[TerminalProcess] Shell integration available: ${!!terminal.shellIntegration?.executeCommand}`)
		console.log(`[TerminalProcess] Terminal ID: ${terminal.name}`)

		if (terminal.shellIntegration?.executeCommand) {
			await this.runWithShellIntegration(terminal, command)
		} else {
			// no shell integration detected, we'll fallback to running the command and capturing the terminal's output after some time
			await this.runWithoutShellIntegration(terminal, command)
		}
	}

	private async initializeForNewCommand(command: string): Promise<void> {
		// Clear any existing grace period timer from previous commands
		if (this.gracePeriodTimer) {
			clearTimeout(this.gracePeriodTimer)
			this.gracePeriodTimer = null
			console.log(`[TerminalProcess] Cleared existing grace period timer before starting new command`)
		}

		// Clear any existing hot timer
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
			this.hotTimer = null
		}

		// Reset state for new command
		this.hasEmittedCompleted = false
		this.buffer = ""
		this.fullOutput = ""
		this.lastRetrievedIndex = 0
		this.isListening = true
		this.isHot = false
		this.command = command
	}

	private async runWithShellIntegration(terminal: vscode.Terminal, command: string): Promise<void> {
		// Execute command and get stream
		const stream = await this.executeCommandWithShellIntegration(terminal, command)
		if (!stream) {
			return
		}

		// Initialize state for stream processing
		const streamState = this.initializeStreamState()

		// Set up timeout for commands with no output
		const firstChunkTimeout = this.setupNoOutputTimeout(command, streamState)

		// Process the output stream
		await this.processOutputStream(stream, command, streamState, firstChunkTimeout)

		// Handle post-stream cleanup
		this.cleanupAfterStream(streamState, firstChunkTimeout)

		// Determine command completion behavior
		await this.handleCommandCompletion(command, streamState)
	}

	private async executeCommandWithShellIntegration(terminal: vscode.Terminal, command: string): Promise<any> {
		try {
			if (!terminal.shellIntegration || !terminal.shellIntegration.executeCommand) {
				throw new Error("Shell integration not available")
			}
			const execution = terminal.shellIntegration.executeCommand(command)
			return execution.read()
		} catch (error) {
			console.error(`[TerminalProcess] Failed to execute command: ${error}`)
			this.emit("error", error as Error)
			return null
		}
	}

	private initializeStreamState() {
		return {
			isFirstChunk: true,
			didOutputNonCommand: false,
			didEmitEmptyLine: false,
			receivedFirstChunk: false,
		}
	}

	private setupNoOutputTimeout(command: string, streamState: any): NodeJS.Timeout {
		// Set up a 3-second timeout to handle commands with no/delayed output.
		// This ensures the UI remains responsive by:
		// 1. Showing the "proceed while running" button after 3 seconds
		// 2. Capturing current terminal contents in case shell integration missed output
		// 3. Informing the user that the command is still running
		return setTimeout(async () => {
			if (!streamState.receivedFirstChunk && !streamState.didEmitEmptyLine) {
				console.log(`[TerminalProcess] First chunk timeout fired - no output received within 3s for: "${command}"`)
				this.emit("line", "") // empty line to show proceed button
				streamState.didEmitEmptyLine = true

				// Capture terminal contents as fallback for shell integration issues
				await this.emitCurrentTerminalContents()
			}
		}, 3000)
	}

	private async processOutputStream(
		stream: any,
		command: string,
		streamState: any,
		firstChunkTimeout: NodeJS.Timeout,
	): Promise<void> {
		for await (let data of stream) {
			// Handle first chunk received
			if (!streamState.receivedFirstChunk) {
				clearTimeout(firstChunkTimeout)
				streamState.receivedFirstChunk = true
				console.log(`[TerminalProcess] First chunk received for command: "${command}"`)
			}

			// Log chunk info
			console.log(`[TerminalProcess] Raw data chunk received: ${data.length} chars`)
			if (!data || data.trim() === "") {
				console.log(`[TerminalProcess] WARNING: Received empty or whitespace-only chunk`)
			}

			// Process the chunk
			data = await this.processChunk(data, command, streamState)

			// Check for Ctrl+C interruption
			if (this.isCommandInterrupted(data)) {
				this.handleInterruption()
				break
			}

			// Update hot/cool state based on output
			this.updateHotState(data)

			// Handle output emission
			this.handleChunkOutput(data, streamState)
		}

		// Emit any remaining buffer content
		this.emitRemainingBufferIfListening()
	}

	private async processChunk(data: string, command: string, streamState: any): Promise<string> {
		if (streamState.isFirstChunk) {
			data = this.cleanFirstChunk(data)
			streamState.isFirstChunk = false
		} else {
			data = stripAnsi(data)
		}

		// Remove command echo if not yet seen real output
		if (!streamState.didOutputNonCommand) {
			data = this.removeCommandEcho(data, command, streamState)
		}

		return data
	}

	private cleanFirstChunk(data: string): string {
		/*
		The first chunk we get from this stream needs to be processed to be more human readable, 
		ie remove vscode's custom escape sequences and identifiers, removing duplicate first char bug, etc.
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
		// Gets output between ]633;C (command start) and ]633;D (command end)
		const outputBetweenSequences = this.removeLastLineArtifacts(data.match(/\]633;C([\s\S]*?)\]633;D/)?.[1] || "").trim()

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

		// remove ansi codes
		data = stripAnsi(data)

		// Split data by newlines for line-by-line processing
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

		// Remove specific terminal artifacts from line beginnings while preserving JSON syntax
		if (lines.length > 0) {
			// This regex only removes common terminal artifacts (%, $, >, #) and invisible control chars
			// but preserves important syntax chars like {, [, ", etc.
			lines[0] = lines[0].replace(/^[\x00-\x1F%$>#\s]*/, "")
		}
		if (lines.length > 1) {
			lines[1] = lines[1].replace(/^[\x00-\x1F%$>#\s]*/, "")
		}

		// Join lines back
		return lines.join("\n")
	}

	private removeCommandEcho(data: string, command: string, streamState: any): string {
		// first few chunks could be the command being echoed back, so we must ignore
		// note this means that 'echo' commands won't work properly
		const lines = data.split("\n")
		for (let i = 0; i < lines.length; i++) {
			const trimmedLine = lines[i].trim()
			// Check if the line is the command being echoed back
			if (trimmedLine && trimmedLine === command.trim()) {
				lines.splice(i, 1)
				i-- // Adjust index after removal
			} else if (trimmedLine) {
				// We've hit actual output, not just the command echo
				streamState.didOutputNonCommand = true
				break
			}
		}
		return lines.join("\n")
	}

	private isCommandInterrupted(data: string): boolean {
		// Ctrl+C detection: if user presses Ctrl+C, treat as command terminated
		return data.includes("^C") || data.includes("\u0003")
	}

	private handleInterruption(): void {
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}
		this.isHot = false
	}

	private updateHotState(data: string): void {
		// Set to hot to stall API requests until terminal is cool again
		this.isHot = true
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}

		const isCompiling = this.detectCompilationStatus(data)
		const timeout = isCompiling ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL

		this.hotTimer = setTimeout(() => {
			this.isHot = false
		}, timeout)
	}

	private detectCompilationStatus(data: string): boolean {
		// these markers indicate the command is some kind of local dev server recompiling the app
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

		return (
			compilingMarkers.some((marker) => data.toLowerCase().includes(marker.toLowerCase())) &&
			!markerNullifiers.some((nullifier) => data.toLowerCase().includes(nullifier.toLowerCase()))
		)
	}

	private handleChunkOutput(data: string, streamState: any): void {
		// For non-immediately returning commands we want to show loading spinner right away
		if (!streamState.didEmitEmptyLine && !this.fullOutput && data) {
			this.emit("line", "") // empty line to indicate start of command output stream
			streamState.didEmitEmptyLine = true
		}

		this.fullOutput += data
		if (this.isListening) {
			this.emitIfEol(data)
			this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
		}
	}

	private cleanupAfterStream(streamState: any, firstChunkTimeout: NodeJS.Timeout): void {
		// Clean up the first chunk timeout if it's still active
		if (!streamState.receivedFirstChunk) {
			clearTimeout(firstChunkTimeout)
			console.log(`[TerminalProcess] WARNING: Stream ended without receiving any chunks for command: "${this.command}"`)
		}

		// Clear hot timer
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}
		this.isHot = false

		console.log(`[TerminalProcess] Stream ended for command: "${this.command}"`)
		console.log(`[TerminalProcess] Final output length: ${this.fullOutput.length} characters`)
	}

	private async handleCommandCompletion(command: string, streamState: any): Promise<void> {
		const commandType = this.analyzeCommandType(command)

		// Handle commands with no output
		if (this.fullOutput.length === 0) {
			console.log(`[TerminalProcess] WARNING: Process completed but no output was captured`)
			if (!streamState.didEmitEmptyLine) {
				await this.emitCurrentTerminalContents()
			}
		}

		// Determine if we should skip grace period
		if (commandType.isQuickCommand && !commandType.isLongRunning) {
			console.log(`[TerminalProcess] Command appears to have completed immediately, skipping grace period`)
			this.emit("completed")
			this.emit("continue")
		} else {
			console.log(`[TerminalProcess] Command may still be running (longRunningCommand: ${commandType.isLongRunning})`)
			console.log(`[TerminalProcess] Starting grace period to detect true completion...`)
			this.startGracePeriod()
		}
	}

	private analyzeCommandType(command: string): { isQuickCommand: boolean; isLongRunning: boolean } {
		// Check if this looks like a command that completed vs one that's still running
		const quickCommands = ["cd ", "pwd", "ls ", "echo ", "mkdir ", "touch ", "rm ", "cp ", "mv "]
		const isQuickCommand = quickCommands.some((cmd) => command.startsWith(cmd) || command.includes(" && " + cmd))

		// Check if output suggests a long-running process
		const longRunningIndicators = [
			"listening on",
			"server running",
			"started on",
			"watching for",
			"compiled successfully",
			"webpack",
			"vite",
			"nodemon",
			"dev server",
			"press ctrl",
			"to quit",
			"to exit",
			"to stop",
		]
		const hasLongRunningOutput = longRunningIndicators.some((indicator) => this.fullOutput.toLowerCase().includes(indicator))

		// Check if this is likely a command that starts a server or long-running process
		const longRunningCommands = ["npm run", "npm start", "yarn", "node ", "python ", "serve", "dev", "watch"]
		const isLongRunningCommand = longRunningCommands.some((cmd) => command.includes(cmd))

		return {
			isQuickCommand: this.fullOutput.length === 0 || isQuickCommand,
			isLongRunning: isLongRunningCommand || hasLongRunningOutput,
		}
	}

	private async runWithoutShellIntegration(terminal: vscode.Terminal, command: string): Promise<void> {
		// Send command to terminal
		terminal.sendText(command, true)

		// wait 3 seconds for the command to run
		await new Promise((resolve) => setTimeout(resolve, 3000))

		// For terminals without shell integration, also try to capture terminal content
		await this.emitCurrentTerminalContents()
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

	// Inspired by https://github.com/sindresorhus/execa/blob/main/lib/transform/split.js
	private emitIfEol(chunk: string) {
		this.buffer += chunk
		let lineEndIndex: number
		let lineCount = 0
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			let line = this.buffer.slice(0, lineEndIndex).trimEnd() // removes trailing \r
			// Remove \r if present (for Windows-style line endings)
			// if (line.endsWith("\r")) {
			// 	line = line.slice(0, -1)
			// }
			if (!line || line.trim() === "") {
				console.log(`[TerminalProcess] Emitting empty line`)
			} else {
				console.log(`[TerminalProcess] Emitting line: ${line.substring(0, 100)}${line.length > 100 ? "..." : ""}`)
			}
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
			lineCount++
		}
		if (lineCount === 0 && chunk.length > 0) {
			console.log(`[TerminalProcess] Buffering partial line, buffer size: ${this.buffer.length}`)
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

	private startGracePeriod() {
		// Clear any existing grace period timer
		if (this.gracePeriodTimer) {
			clearTimeout(this.gracePeriodTimer)
		}

		// Emit completed event for UI to show "proceed while running" button
		console.log(`[TerminalProcess] Emitting completed event for UI (grace period active)`)
		this.emit("completed")

		// Wait 2.5 seconds to see if the command is truly finished
		this.gracePeriodTimer = setTimeout(() => {
			// Double-check the timer hasn't been cleared
			if (this.gracePeriodTimer && !this.hasEmittedCompleted) {
				console.log(`[TerminalProcess] Grace period completed - command appears truly finished: "${this.command}"`)
				console.log(`[TerminalProcess] Auto-continuing without user intervention`)
				this.hasEmittedCompleted = true
				this.gracePeriodTimer = null
				// Only emit continue after the grace period, not immediately
				this.emit("continue")
			}
		}, 2500) // 2.5 second grace period
	}

	continue() {
		console.log(`[TerminalProcess] Manual continue() called for: "${this.command}"`)

		// Clear grace period since user manually continued
		if (this.gracePeriodTimer) {
			console.log(`[TerminalProcess] Clearing grace period timer due to manual continue`)
			clearTimeout(this.gracePeriodTimer)
			this.gracePeriodTimer = null
		}

		this.hasEmittedCompleted = true
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
