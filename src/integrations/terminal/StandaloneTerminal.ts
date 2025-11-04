// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Options for creating a standalone terminal
 */
interface TerminalCreationOptions {
	name?: string
	cwd?: string
	shellPath?: string
}

/**
 * Terminal state information
 */
interface TerminalState {
	isInteractedWith: boolean
}

/**
 * Exit status of a terminal
 */
interface TerminalExitStatus {
	code: number
	reason?: string
}

/**
 * Shell integration mock for compatibility with VSCode API
 */
interface ShellIntegration {
	cwd: {
		fsPath: string
	}
	executeCommand: (command: string) => {
		read: () => AsyncGenerator<string, void, unknown>
	}
}

/**
 * Information about a terminal instance tracked by the registry
 */
interface TerminalInfo {
	id: number
	terminal: StandaloneTerminal
	busy: boolean
	lastCommand: string
	shellPath?: string
	lastActive: number
	pendingCwdChange: string | undefined
	cwdResolved: string | undefined
}

/**
 * Terminal info for external consumption
 */
interface TerminalExternalInfo {
	id: number
	lastCommand: string
}

/**
 * Merged promise and process object
 */
interface MergedPromiseProcess extends StandaloneTerminalProcess, Promise<void> {}

// ============================================================================
// Classes
// ============================================================================

import { ChildProcess, spawn } from "child_process"
import { EventEmitter } from "events"

// Enhanced terminal management for standalone Cline
// This replaces VSCode's terminal integration with real subprocess management

class StandaloneTerminalProcess extends EventEmitter {
	waitForShellIntegration: boolean
	isListening: boolean
	buffer: string
	fullOutput: string
	lastRetrievedIndex: number
	isHot: boolean
	hotTimer: NodeJS.Timeout | null
	childProcess: ChildProcess | null
	exitCode: number | null
	isCompleted: boolean

	constructor() {
		super()
		this.waitForShellIntegration = false // We don't need to wait since we control the process
		this.isListening = true
		this.buffer = ""
		this.fullOutput = ""
		this.lastRetrievedIndex = 0
		this.isHot = false
		this.hotTimer = null
		this.childProcess = null
		this.exitCode = null
		this.isCompleted = false
	}

	async run(terminal: StandaloneTerminal, command: string): Promise<void> {
		console.log(`[StandaloneTerminal] Running command: ${command}`)

		// Get shell and working directory from terminal
		const shell: string = terminal._shellPath || this.getDefaultShell()
		const cwd: string = terminal._cwd || process.cwd()

		// Prepare command for execution
		const shellArgs: string[] = this.getShellArgs(shell, command)

		try {
			// Spawn the process
			this.childProcess = spawn(shell, shellArgs, {
				cwd: cwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, TERM: "xterm-256color" },
			})

			// Track process state
			let didEmitEmptyLine = false

			// Handle stdout
			this.childProcess.stdout?.on("data", (data: Buffer) => {
				const output = data.toString()
				this.handleOutput(output, didEmitEmptyLine)
				if (!didEmitEmptyLine && output) {
					this.emit("line", "") // Signal start of output
					didEmitEmptyLine = true
				}
			})

			// Handle stderr
			this.childProcess.stderr?.on("data", (data: Buffer) => {
				const output = data.toString()
				this.handleOutput(output, didEmitEmptyLine)
				if (!didEmitEmptyLine && output) {
					this.emit("line", "")
					didEmitEmptyLine = true
				}
			})

			// Handle process completion
			this.childProcess.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
				console.log(`[StandaloneTerminal] Process closed with code ${code}, signal ${signal}`)
				this.exitCode = code
				this.isCompleted = true
				this.emitRemainingBuffer()

				// Clear hot timer
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
					this.isHot = false
				}

				this.emit("completed")
				this.emit("continue")
			})

			// Handle process errors
			this.childProcess.on("error", (error: Error) => {
				console.error(`[StandaloneTerminal] Process error:`, error)
				this.emit("error", error)
			})

			// Update terminal's process reference
			terminal._process = this.childProcess
			terminal._processId = this.childProcess.pid
		} catch (error) {
			console.error(`[StandaloneTerminal] Failed to spawn process:`, error)
			this.emit("error", error)
		}
	}

	handleOutput(data: string, _didEmitEmptyLine: boolean): void {
		// Set process as hot (actively outputting)
		this.isHot = true
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}

		// Check for compilation markers to adjust hot timeout
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

		const hotTimeout = isCompiling ? 15000 : 2000
		this.hotTimer = setTimeout(() => {
			this.isHot = false
		}, hotTimeout)

		// Store full output
		this.fullOutput += data

		if (this.isListening) {
			this.emitLines(data)
			this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
		}
	}

	emitLines(chunk: string): void {
		this.buffer += chunk
		let lineEndIndex: number
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, lineEndIndex).trimEnd()
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	emitRemainingBuffer(): void {
		if (this.buffer && this.isListening) {
			const remainingBuffer = this.removeLastLineArtifacts(this.buffer)
			if (remainingBuffer) {
				this.emit("line", remainingBuffer)
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	continue(): void {
		this.emitRemainingBuffer()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return this.removeLastLineArtifacts(unretrieved)
	}

	removeLastLineArtifacts(output: string): string {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}

	getDefaultShell(): string {
		if (process.platform === "win32") {
			return process.env.COMSPEC || "cmd.exe"
		} else {
			return process.env.SHELL || "/bin/bash"
		}
	}

	getShellArgs(shell: string, command: string): string[] {
		if (process.platform === "win32") {
			if (shell.toLowerCase().includes("powershell") || shell.toLowerCase().includes("pwsh")) {
				return ["-Command", command]
			} else {
				return ["/c", command]
			}
		} else {
			// Use -l for login shell, -c for command
			return ["-l", "-c", command]
		}
	}

	// Terminate the process if it's still running
	terminate(): void {
		if (this.childProcess && !this.isCompleted) {
			console.log(`[StandaloneTerminal] Terminating process ${this.childProcess.pid}`)
			this.childProcess.kill("SIGTERM")

			// Force kill after timeout
			setTimeout(() => {
				if (!this.isCompleted && this.childProcess) {
					console.log(`[StandaloneTerminal] Force killing process ${this.childProcess.pid}`)
					this.childProcess.kill("SIGKILL")
				}
			}, 5000)
		}
	}
}

class StandaloneTerminal {
	name: string
	processId: Promise<number>
	creationOptions: TerminalCreationOptions
	exitStatus: TerminalExitStatus | undefined
	state: TerminalState
	_cwd: string
	_shellPath: string | undefined
	_process: ChildProcess | null
	_processId: number | undefined
	shellIntegration: ShellIntegration

	constructor(options: TerminalCreationOptions = {}) {
		this.name = options.name || `Terminal ${Math.floor(Math.random() * 10000)}`
		this.processId = Promise.resolve(Math.floor(Math.random() * 100000))
		this.creationOptions = options
		this.exitStatus = undefined
		this.state = { isInteractedWith: false }
		this._cwd = options.cwd || process.cwd()
		this._shellPath = options.shellPath
		this._process = null
		this._processId = undefined

		// Mock shell integration for compatibility
		this.shellIntegration = {
			cwd: { fsPath: this._cwd },
			executeCommand: (_command: string) => {
				// Return a mock execution object that the TerminalProcess expects
				return {
					read: async function* () {
						// This will be handled by our StandaloneTerminalProcess
						yield ""
					},
				}
			},
		}

		console.log(`[StandaloneTerminal] Created terminal: ${this.name} in ${this._cwd}`)
	}

	sendText(text: string, addNewLine: boolean = true): void {
		console.log(`[StandaloneTerminal] sendText: ${text}`)

		// If we have an active process, send input to it
		if (this._process && !this._process.killed) {
			try {
				this._process.stdin?.write(text + (addNewLine ? "\n" : ""))
			} catch (error) {
				console.error(`[StandaloneTerminal] Error sending text to process:`, error)
			}
		} else {
			// For compatibility with old behavior, we could spawn a new process
			console.log(`[StandaloneTerminal] No active process to send text to`)
		}
	}

	show(): void {
		console.log(`[StandaloneTerminal] show: ${this.name}`)
		this.state.isInteractedWith = true
	}

	hide(): void {
		console.log(`[StandaloneTerminal] hide: ${this.name}`)
	}

	dispose(): void {
		console.log(`[StandaloneTerminal] dispose: ${this.name}`)
		if (this._process && !this._process.killed) {
			this._process.kill("SIGTERM")
		}
	}
}

// Terminal registry for tracking terminals
class StandaloneTerminalRegistry {
	terminals: Map<number, TerminalInfo>
	nextId: number

	constructor() {
		this.terminals = new Map<number, TerminalInfo>()
		this.nextId = 1
	}

	createTerminal(options: TerminalCreationOptions = {}): TerminalInfo {
		const terminal = new StandaloneTerminal(options)
		const id = this.nextId++

		const terminalInfo: TerminalInfo = {
			id: id,
			terminal: terminal,
			busy: false,
			lastCommand: "",
			shellPath: options.shellPath,
			lastActive: Date.now(),
			pendingCwdChange: undefined,
			cwdResolved: undefined,
		}

		this.terminals.set(id, terminalInfo)
		console.log(`[StandaloneTerminalRegistry] Created terminal ${id}`)
		return terminalInfo
	}

	getTerminal(id: number): TerminalInfo | undefined {
		return this.terminals.get(id)
	}

	getAllTerminals(): TerminalInfo[] {
		return Array.from(this.terminals.values())
	}

	removeTerminal(id: number): void {
		const terminalInfo = this.terminals.get(id)
		if (terminalInfo) {
			terminalInfo.terminal.dispose()
			this.terminals.delete(id)
			console.log(`[StandaloneTerminalRegistry] Removed terminal ${id}`)
		}
	}

	updateTerminal(id: number, updates: Partial<TerminalInfo>): void {
		const terminalInfo = this.terminals.get(id)
		if (terminalInfo) {
			Object.assign(terminalInfo, updates)
		}
	}
}

// Enhanced terminal manager
class StandaloneTerminalManager {
	registry: StandaloneTerminalRegistry
	processes: Map<number, StandaloneTerminalProcess>
	terminalIds: Set<number>
	shellIntegrationTimeout: number
	terminalReuseEnabled: boolean
	terminalOutputLineLimit: number
	subagentTerminalOutputLineLimit: number
	defaultTerminalProfile: string

	constructor() {
		this.registry = new StandaloneTerminalRegistry()
		this.processes = new Map<number, StandaloneTerminalProcess>()
		this.terminalIds = new Set<number>()
		this.shellIntegrationTimeout = 4000
		this.terminalReuseEnabled = true
		this.terminalOutputLineLimit = 500
		this.subagentTerminalOutputLineLimit = 2000
		this.defaultTerminalProfile = "default"
	}

	runCommand(terminalInfo: TerminalInfo, command: string): MergedPromiseProcess {
		console.log(`[StandaloneTerminalManager] Running command on terminal ${terminalInfo.id}: ${command}`)

		terminalInfo.busy = true
		terminalInfo.lastCommand = command

		const process = new StandaloneTerminalProcess()
		this.processes.set(terminalInfo.id, process)

		process.once("completed", () => {
			terminalInfo.busy = false
			console.log(`[StandaloneTerminalManager] Command completed on terminal ${terminalInfo.id}`)
		})

		process.once("error", (error: Error) => {
			terminalInfo.busy = false
			console.error(`[StandaloneTerminalManager] Command error on terminal ${terminalInfo.id}:`, error)
		})

		// Create promise for the process
		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => resolve())
			process.once("error", (error: Error) => reject(error))
		})

		// Run the command immediately (no shell integration wait needed)
		process.run(terminalInfo.terminal, command)

		// Return merged promise/process object
		return this.mergePromise(process, promise)
	}

	async getOrCreateTerminal(cwd: string): Promise<TerminalInfo> {
		const terminals = this.registry.getAllTerminals()

		// Find available terminal with matching CWD
		const matchingTerminal = terminals.find((t) => {
			if (t.busy) {
				return false
			}
			return t.terminal._cwd === cwd
		})

		if (matchingTerminal) {
			this.terminalIds.add(matchingTerminal.id)
			console.log(`[StandaloneTerminalManager] Reusing terminal ${matchingTerminal.id}`)
			return matchingTerminal
		}

		// Find any available terminal if reuse is enabled
		if (this.terminalReuseEnabled) {
			const availableTerminal = terminals.find((t) => !t.busy)
			if (availableTerminal) {
				// Change directory
				await this.runCommand(availableTerminal, `cd "${cwd}"`)
				availableTerminal.terminal._cwd = cwd
				availableTerminal.terminal.shellIntegration.cwd.fsPath = cwd
				this.terminalIds.add(availableTerminal.id)
				console.log(`[StandaloneTerminalManager] Reused terminal ${availableTerminal.id} with cd`)
				return availableTerminal
			}
		}

		// Create new terminal
		const newTerminalInfo = this.registry.createTerminal({
			cwd: cwd,
			name: `Cline Terminal ${this.registry.nextId}`,
		})
		this.terminalIds.add(newTerminalInfo.id)
		console.log(`[StandaloneTerminalManager] Created new terminal ${newTerminalInfo.id}`)
		return newTerminalInfo
	}

	getTerminals(busy: boolean): TerminalExternalInfo[] {
		return Array.from(this.terminalIds)
			.map((id) => this.registry.getTerminal(id))
			.filter((t): t is TerminalInfo => t !== undefined && t.busy === busy)
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }))
	}

	getUnretrievedOutput(terminalId: number): string {
		if (!this.terminalIds.has(terminalId)) {
			return ""
		}
		const process = this.processes.get(terminalId)
		return process ? process.getUnretrievedOutput() : ""
	}

	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	processOutput(outputLines: string[], overrideLimit: number | undefined, isSubagentCommand: boolean): string {
		const limit = isSubagentCommand && overrideLimit ? overrideLimit : this.terminalOutputLineLimit
		if (outputLines.length > limit) {
			const halfLimit = Math.floor(limit / 2)
			const start = outputLines.slice(0, halfLimit)
			const end = outputLines.slice(outputLines.length - halfLimit)
			return `${start.join("\n")}\n... (output truncated) ...\n${end.join("\n")}`.trim()
		}
		return outputLines.join("\n").trim()
	}

	disposeAll(): void {
		// Terminate all processes
		for (const [_terminalId, process] of this.processes) {
			if (process && process.terminate) {
				process.terminate()
			}
		}

		// Clear all tracking
		this.terminalIds.clear()
		this.processes.clear()

		// Dispose all terminals
		for (const terminalInfo of this.registry.getAllTerminals()) {
			terminalInfo.terminal.dispose()
		}

		console.log(`[StandaloneTerminalManager] Disposed all terminals`)
	}

	// Set shell integration timeout (compatibility method)
	setShellIntegrationTimeout(timeout: number): void {
		this.shellIntegrationTimeout = timeout
		console.log(`[StandaloneTerminalManager] Set shell integration timeout to ${timeout}ms`)
	}

	// Set terminal reuse enabled (compatibility method)
	setTerminalReuseEnabled(enabled: boolean): void {
		this.terminalReuseEnabled = enabled
		console.log(`[StandaloneTerminalManager] Set terminal reuse enabled to ${enabled}`)
	}

	// Set terminal output line limit (compatibility method)
	setTerminalOutputLineLimit(limit: number): void {
		this.terminalOutputLineLimit = limit
		console.log(`[StandaloneTerminalManager] Set terminal output line limit to ${limit}`)
	}

	// Set subagent terminal output line limit (compatibility method)
	setSubagentTerminalOutputLineLimit(limit: number): void {
		this.subagentTerminalOutputLineLimit = limit
		console.log(`[StandaloneTerminalManager] Set subagent terminal output line limit to ${limit}`)
	}

	// Set default terminal profile (compatibility method)
	setDefaultTerminalProfile(profile: string): void {
		this.defaultTerminalProfile = profile
		console.log(`[StandaloneTerminalManager] Set default terminal profile to ${profile}`)
	}

	// Helper to merge process and promise (similar to execa)
	mergePromise(process: StandaloneTerminalProcess, promise: Promise<void>): MergedPromiseProcess {
		const nativePromisePrototype = (async () => {})().constructor.prototype
		const descriptors: Array<[string, PropertyDescriptor | undefined]> = ["then", "catch", "finally"].map((property) => [
			property,
			Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property),
		])

		for (const [property, descriptor] of descriptors) {
			if (descriptor && descriptor.value) {
				const value = descriptor.value.bind(promise)
				Reflect.defineProperty(process, property, { ...descriptor, value })
			}
		}

		return process as MergedPromiseProcess
	}
}

// ============================================================================
// Exports
// ============================================================================

export { StandaloneTerminal, StandaloneTerminalProcess, StandaloneTerminalRegistry, StandaloneTerminalManager }
