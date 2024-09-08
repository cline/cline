import * as vscode from "vscode"
import { EventEmitter } from "events"
import delay from "delay"

/*
TerminalManager:
- Creates/reuses terminals
- Runs commands via runCommand(), returning a TerminalProcess
- Handles shell integration events

TerminalProcess extends EventEmitter and implements Promise:
- Emits 'line' events with output while promise is pending
- process.continue() resolves promise and stops event emission
- Allows real-time output handling or background execution

getUnretrievedOutput() fetches latest output for ongoing commands

Enables flexible command execution:
- Await for completion
- Listen to real-time events
- Continue execution in background
- Retrieve missed output later

Example:

const terminalManager = new TerminalManager(context);

// Run a command
const process = terminalManager.runCommand('npm install', '/path/to/project');

process.on('line', (line) => {
    console.log(line);
});

// To wait for the process to complete naturally:
await process;

// Or to continue execution even if the command is still running:
process.continue();

// Later, if you need to get the unretrieved output:
const unretrievedOutput = terminalManager.getUnretrievedOutput(terminalId);
console.log('Unretrieved output:', unretrievedOutput);
*/

export class TerminalManager {
	private terminals: TerminalInfo[] = []
	private processes: Map<number, TerminalProcess> = new Map()
	private context: vscode.ExtensionContext
	private nextTerminalId = 1

	constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.setupListeners()
	}

	private setupListeners() {
		// todo: make sure we do this check everywhere we use the new terminal APIs
		if (hasShellIntegrationApis()) {
			this.context.subscriptions.push(
				vscode.window.onDidOpenTerminal(this.handleOpenTerminal.bind(this)),
				vscode.window.onDidCloseTerminal(this.handleClosedTerminal.bind(this)),
				vscode.window.onDidChangeTerminalShellIntegration(this.handleShellIntegrationChange.bind(this)),
				vscode.window.onDidStartTerminalShellExecution(this.handleShellExecutionStart.bind(this)),
				vscode.window.onDidEndTerminalShellExecution(this.handleShellExecutionEnd.bind(this))
			)
		}
	}

	runCommand(terminalInfo: TerminalInfo, command: string, cwd: string): TerminalProcessResultPromise {
		terminalInfo.busy = true
		terminalInfo.lastCommand = command

		const process = new TerminalProcess(terminalInfo, command)

		this.processes.set(terminalInfo.id, process)

		const promise = new Promise<void>((resolve, reject) => {
			process.once(CONTINUE_EVENT, () => {
				console.log("2")
				resolve()
			})
			process.once("error", reject)
		})

		// if shell integration is already active, run the command immediately
		if (terminalInfo.terminal.shellIntegration) {
			process.waitForShellIntegration = false
			process.run()
		}

		if (hasShellIntegrationApis()) {
			// Fallback to sendText if there is no shell integration within 3 seconds of launching (could be because the user is not running one of the supported shells)
			setTimeout(() => {
				if (!terminalInfo.terminal.shellIntegration) {
					process.waitForShellIntegration = false
					process.run()
					// Without shell integration, we can't know when the command has finished or what the
					// exit code was.
				}
			}, 3000)
		} else {
			// User doesn't have shell integration API available, run command the old way
			process.waitForShellIntegration = false
			process.run()
		}

		// Merge the process and promise
		return mergePromise(process, promise)
	}

	async getOrCreateTerminal(cwd: string): Promise<TerminalInfo> {
		const availableTerminal = this.terminals.find((t) => {
			if (t.busy) {
				return false
			}
			const terminalCwd = t.terminal.shellIntegration?.cwd // one of claude's commands could have changed the cwd of the terminal
			if (!terminalCwd) {
				return false
			}
			return vscode.Uri.file(cwd).fsPath === terminalCwd.fsPath
		})
		if (availableTerminal) {
			console.log("reusing terminal", availableTerminal.id)
			return availableTerminal
		}

		const newTerminal = vscode.window.createTerminal({
			name: "Claude Dev",
			cwd: cwd,
			iconPath: new vscode.ThemeIcon("robot"),
		})
		const newTerminalInfo: TerminalInfo = {
			terminal: newTerminal,
			busy: false,
			lastCommand: "",
			id: this.nextTerminalId++,
		}
		this.terminals.push(newTerminalInfo)
		return newTerminalInfo
	}

	private handleOpenTerminal(terminal: vscode.Terminal) {
		console.log(`Terminal opened: ${terminal.name}`)
	}

	private handleClosedTerminal(terminal: vscode.Terminal) {
		const index = this.terminals.findIndex((t) => t.terminal === terminal)
		if (index !== -1) {
			const terminalInfo = this.terminals[index]
			this.terminals.splice(index, 1)
			this.processes.delete(terminalInfo.id)
		}
		console.log(`Terminal closed: ${terminal.name}`)
	}

	private handleShellIntegrationChange(e: vscode.TerminalShellIntegrationChangeEvent) {
		const terminalInfo = this.terminals.find((t) => t.terminal === e.terminal)
		if (terminalInfo) {
			const process = this.processes.get(terminalInfo.id)
			if (process && process.waitForShellIntegration) {
				process.waitForShellIntegration = false
				process.run()
			}
			console.log(`Shell integration activated for terminal: ${e.terminal.name}`)
		}
	}

	private handleShellExecutionStart(e: vscode.TerminalShellExecutionStartEvent) {
		const terminalInfo = this.terminals.find((t) => t.terminal === e.terminal)
		if (terminalInfo) {
			terminalInfo.busy = true
			terminalInfo.lastCommand = e.execution.commandLine.value
			console.log(`Command started in terminal ${terminalInfo.id}: ${terminalInfo.lastCommand}`)
		}
	}

	private handleShellExecutionEnd(e: vscode.TerminalShellExecutionEndEvent) {
		const terminalInfo = this.terminals.find((t) => t.terminal === e.terminal)
		if (terminalInfo) {
			this.handleCommandCompletion(terminalInfo, e.exitCode)
		}
	}

	private handleCommandCompletion(terminalInfo: TerminalInfo, exitCode?: number | undefined) {
		terminalInfo.busy = false
		console.log(
			`Command "${terminalInfo.lastCommand}" in terminal ${terminalInfo.id} completed with exit code: ${exitCode}`
		)
	}

	getBusyTerminals(): { id: number; lastCommand: string }[] {
		return this.terminals.filter((t) => t.busy).map((t) => ({ id: t.id, lastCommand: t.lastCommand }))
	}

	hasBusyTerminals(): boolean {
		return this.terminals.some((t) => t.busy)
	}

	getUnretrievedOutput(terminalId: number): string {
		const process = this.processes.get(terminalId)
		if (!process) {
			return ""
		}
		return process.getUnretrievedOutput()
	}

	disposeAll() {
		for (const info of this.terminals) {
			info.terminal.dispose() // todo do we want to do this? test with tab view closing it
		}
		this.terminals = []
		this.processes.clear()
	}
}

function hasShellIntegrationApis(): boolean {
	const [major, minor] = vscode.version.split(".").map(Number)
	return major > 1 || (major === 1 && minor >= 93)
}

interface TerminalInfo {
	terminal: vscode.Terminal
	busy: boolean
	lastCommand: string
	id: number
}

const CONTINUE_EVENT = "CONTINUE_EVENT"

export class TerminalProcess extends EventEmitter {
	waitForShellIntegration: boolean = true
	private isListening: boolean = true
	private buffer: string = ""
	private execution?: vscode.TerminalShellExecution
	private stream?: AsyncIterable<string>
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0

	constructor(public terminalInfo: TerminalInfo, private command: string) {
		super()
	}

	async run() {
		if (this.terminalInfo.terminal.shellIntegration) {
			this.execution = this.terminalInfo.terminal.shellIntegration.executeCommand(this.command)
			this.stream = this.execution.read()
			// todo: need to handle errors
			let isFirstChunk = true // ignore first chunk since it's vscode shell integration marker
			for await (const data of this.stream) {
				console.log("data", data)
				if (!isFirstChunk) {
					this.fullOutput += data
					if (this.isListening) {
						this.emitIfEol(data)
						this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
					}
				} else {
					isFirstChunk = false
				}
			}

			// Emit any remaining content in the buffer
			if (this.buffer && this.isListening) {
				this.emit("line", this.buffer.trim())
				this.buffer = ""
				this.lastRetrievedIndex = this.fullOutput.length
			}

			this.emit(CONTINUE_EVENT)
		} else {
			this.terminalInfo.terminal.sendText(this.command, true)
			// For terminals without shell integration, we can't know when the command completes
			// So we'll just emit the continue event after a delay
			setTimeout(() => {
				this.emit(CONTINUE_EVENT)
			}, 2000) // Adjust this delay as needed
		}
	}

	// Inspired by https://github.com/sindresorhus/execa/blob/main/lib/transform/split.js
	private emitIfEol(chunk: string) {
		this.buffer += chunk
		let lineEndIndex: number
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			let line = this.buffer.slice(0, lineEndIndex).trim()
			// Remove \r if present (for Windows-style line endings)
			// if (line.endsWith("\r")) {
			// 	line = line.slice(0, -1)
			// }
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	continue() {
		this.isListening = false
		this.removeAllListeners("line")
		this.emit(CONTINUE_EVENT)
	}

	isStillListening() {
		return this.isListening
	}

	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return unretrieved
	}
}

export type TerminalProcessResultPromise = TerminalProcess & Promise<void>

// Similar to execa's ResultPromise, this lets us create a mixin of both a TerminalProcess and a Promise: https://github.com/sindresorhus/execa/blob/main/lib/methods/promise.js
function mergePromise(process: TerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
	const nativePromisePrototype = (async () => {})().constructor.prototype
	const descriptors = ["then", "catch", "finally"].map(
		(property) => [property, Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property)] as const
	)
	for (const [property, descriptor] of descriptors) {
		if (descriptor) {
			const value = descriptor.value.bind(promise)
			Reflect.defineProperty(process, property, { ...descriptor, value })
		}
	}
	return process as TerminalProcessResultPromise
}
