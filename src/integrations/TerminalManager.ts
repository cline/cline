import * as vscode from "vscode"
import { EventEmitter } from "events"
import pWaitFor from "p-wait-for"

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

Notes:
- it turns out some shellIntegration APIs are available on cursor, although not on older versions of vscode
- "By default, the shell integration script should automatically activate on supported shells launched from VS Code."
Supported shells:
Linux/macOS: bash, fish, pwsh, zsh
Windows: pwsh


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

Resources:
- https://github.com/microsoft/vscode/issues/226655
- https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api
- https://code.visualstudio.com/docs/terminal/shell-integration
- https://code.visualstudio.com/api/references/vscode-api#Terminal
- https://github.com/microsoft/vscode-extension-samples/blob/main/terminal-sample/src/extension.ts
- https://github.com/microsoft/vscode-extension-samples/blob/main/shell-integration-sample/src/extension.ts
*/

export class TerminalManager {
	private terminals: TerminalInfo[] = []
	private processes: Map<number, TerminalProcess> = new Map()
	private nextTerminalId = 1

	runCommand(terminalInfo: TerminalInfo, command: string, cwd: string): TerminalProcessResultPromise {
		terminalInfo.busy = true
		terminalInfo.lastCommand = command
		const process = new TerminalProcess()
		this.processes.set(terminalInfo.id, process)

		process.once("completed", () => {
			console.log(`completed received for terminal ${terminalInfo.id}`)
			terminalInfo.busy = false
		})

		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => {
				console.log(`continue received for terminal ${terminalInfo.id}`)
				resolve()
			})
			process.once("error", (error) => {
				console.error(`Error in terminal ${terminalInfo.id}:`, error)
				reject(error)
			})
		})

		// if shell integration is already active, run the command immediately
		if (terminalInfo.terminal.shellIntegration) {
			console.log(`Shell integration active for terminal ${terminalInfo.id}, running command immediately`)
			process.waitForShellIntegration = false
			process.run(terminalInfo.terminal, command)
		} else {
			console.log(`Waiting for shell integration for terminal ${terminalInfo.id}`)
			// docs recommend waiting 3s for shell integration to activate
			pWaitFor(() => terminalInfo.terminal.shellIntegration !== undefined, { timeout: 4000 }).finally(() => {
				console.log(
					`Shell integration ${
						terminalInfo.terminal.shellIntegration ? "activated" : "not activated"
					} for terminal ${terminalInfo.id}`
				)

				const existingProcess = this.processes.get(terminalInfo.id)
				if (existingProcess && existingProcess.waitForShellIntegration) {
					existingProcess.waitForShellIntegration = false
					existingProcess.run(terminalInfo.terminal, command)
				}
			})
		}

		return mergePromise(process, promise)
	}

	async getOrCreateTerminal(cwd: string): Promise<TerminalInfo> {
		const availableTerminal = this.terminals.find((t) => {
			// it seems even if you close the terminal, it can still be reused
			const isDisposed = !t.terminal || t.terminal.exitStatus // The exit status of the terminal will be undefined while the terminal is active.
			console.log(`Terminal ${t.id} isDisposed:`, isDisposed)
			if (t.busy || isDisposed) {
				return false
			}
			const terminalCwd = t.terminal.shellIntegration?.cwd // one of claude's commands could have changed the cwd of the terminal
			if (!terminalCwd) {
				return false
			}
			return vscode.Uri.file(cwd).fsPath === terminalCwd.fsPath
		})
		if (availableTerminal) {
			console.log("Reusing terminal", availableTerminal.id)
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

	getBusyTerminals(): { id: number; lastCommand: string }[] {
		return this.terminals.filter((t) => t.busy).map((t) => ({ id: t.id, lastCommand: t.lastCommand }))
	}

	getUnretrievedOutput(terminalId: number): string {
		const process = this.processes.get(terminalId)
		if (!process) {
			return ""
		}
		return process.getUnretrievedOutput()
	}

	disposeAll() {
		// for (const info of this.terminals) {
		// 	//info.terminal.dispose() // dont want to dispose terminals when task is aborted
		// }
		this.terminals = []
		this.processes.clear()
	}
}

interface TerminalInfo {
	terminal: vscode.Terminal
	busy: boolean
	lastCommand: string
	id: number
}

interface TerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: []
	error: [error: Error]
}

export class TerminalProcess extends EventEmitter<TerminalProcessEvents> {
	waitForShellIntegration: boolean = true
	private isListening: boolean = true
	private buffer: string = ""
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0

	// constructor() {
	// 	super()

	async run(terminal: vscode.Terminal, command: string) {
		if (terminal.shellIntegration) {
			console.log(`Shell integration available for terminal`)
			const execution = terminal.shellIntegration.executeCommand(command)
			const stream = execution.read()
			// todo: need to handle errors
			for await (const data of stream) {
				console.log(`Received data chunk for terminal:`, data)
				this.fullOutput += data
				if (this.isListening) {
					console.log(`Emitting data for terminal`)
					this.emitIfEol(data)
					this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
				}
			}

			// Emit any remaining content in the buffer
			if (this.buffer && this.isListening) {
				console.log(`Emitting remaining buffer for terminal:`, this.buffer.trim())
				this.emit("line", this.buffer.trim())
				this.buffer = ""
				this.lastRetrievedIndex = this.fullOutput.length
			}

			console.log(`Command execution completed for terminal`)
			this.emit("continue")
			this.emit("completed")
		} else {
			console.log(`Shell integration not available for terminal, falling back to sendText`)
			terminal.sendText(command, true)
			// For terminals without shell integration, we can't know when the command completes
			// So we'll just emit the continue event after a delay
			setTimeout(() => {
				console.log(`Emitting continue after delay for terminal`)
				this.emit("continue")
				// can't emit completed since we don't if the command actually completed, it could still be running server
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
		// Emit any remaining content in the buffer
		if (this.buffer && this.isListening) {
			console.log(`Emitting remaining buffer for terminal:`, this.buffer.trim())
			this.emit("line", this.buffer.trim())
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}

		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
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
