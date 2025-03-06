import * as vscode from "vscode"
import { ExitCodeDetails, TerminalProcess } from "./TerminalProcess"

export class Terminal {
	public terminal: vscode.Terminal
	public busy: boolean
	public lastCommand: string
	public id: number
	private stream?: AsyncIterable<string>
	public running: boolean
	private streamClosed: boolean
	public process?: TerminalProcess

	constructor(id: number, terminal: vscode.Terminal) {
		this.id = id
		this.terminal = terminal
		this.busy = false
		this.lastCommand = ""
		this.running = false
		this.streamClosed = false
	}

	/**
	 * Gets the terminal's stream
	 */
	public getStream(): AsyncIterable<string> | undefined {
		return this.stream
	}

	/**
	 * Checks if the stream is closed
	 */
	public isStreamClosed(): boolean {
		return this.streamClosed
	}

	/**
	 * Sets the active stream for this terminal and notifies the process
	 * @param stream The stream to set, or undefined to clean up
	 * @throws Error if process is undefined when a stream is provided
	 */
	public setActiveStream(stream: AsyncIterable<string> | undefined): void {
		this.stream = stream

		if (stream) {
			// New stream is available
			if (!this.process) {
				throw new Error(`Cannot set active stream on terminal ${this.id} because process is undefined`)
			}

			this.streamClosed = false
			this.running = true
			this.process.emit("stream_available", this.id, stream)
		} else {
			// Stream is being closed
			this.streamClosed = true
			this.running = false
		}
	}

	/**
	 * Handles shell execution completion for this terminal
	 * @param exitDetails The exit details of the shell execution
	 */
	public shellExecutionComplete(exitDetails: ExitCodeDetails): void {
		this.running = false

		if (this.process) {
			this.process.emit("shell_execution_complete", this.id, exitDetails)
			this.process = undefined
		}
	}

	/**
	 * Gets the terminal contents based on the number of commands to include
	 * @param commands Number of previous commands to include (-1 for all)
	 * @returns The selected terminal contents
	 */
	public static async getTerminalContents(commands = -1): Promise<string> {
		// Save current clipboard content
		const tempCopyBuffer = await vscode.env.clipboard.readText()

		try {
			// Select terminal content
			if (commands < 0) {
				await vscode.commands.executeCommand("workbench.action.terminal.selectAll")
			} else {
				for (let i = 0; i < commands; i++) {
					await vscode.commands.executeCommand("workbench.action.terminal.selectToPreviousCommand")
				}
			}

			// Copy selection and clear it
			await vscode.commands.executeCommand("workbench.action.terminal.copySelection")
			await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

			// Get copied content
			let terminalContents = (await vscode.env.clipboard.readText()).trim()

			// Restore original clipboard content
			await vscode.env.clipboard.writeText(tempCopyBuffer)

			if (tempCopyBuffer === terminalContents) {
				// No terminal content was copied
				return ""
			}

			// Process multi-line content
			const lines = terminalContents.split("\n")
			const lastLine = lines.pop()?.trim()
			if (lastLine) {
				let i = lines.length - 1
				while (i >= 0 && !lines[i].trim().startsWith(lastLine)) {
					i--
				}
				terminalContents = lines.slice(Math.max(i, 0)).join("\n")
			}

			return terminalContents
		} catch (error) {
			// Ensure clipboard is restored even if an error occurs
			await vscode.env.clipboard.writeText(tempCopyBuffer)
			throw error
		}
	}
}
