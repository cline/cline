const { spawn } = require("child_process")
const { EventEmitter } = require("events")
const _path = require("path")
const _os = require("os")

// Enhanced terminal management for standalone Cline
// This replaces VSCode's terminal integration with real subprocess management

class StandaloneTerminalProcess extends EventEmitter {
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

	async run(terminal, command) {
		console.log(`[StandaloneTerminal] Running command: ${command}`)

		// Get shell and working directory from terminal
		const shell = terminal._shellPath || this.getDefaultShell()
		const cwd = terminal._cwd || process.cwd()

		// Prepare command for execution
		const shellArgs = this.getShellArgs(shell, command)

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
			this.childProcess.stdout.on("data", (data) => {
				const output = data.toString()
				this.handleOutput(output, didEmitEmptyLine)
				if (!didEmitEmptyLine && output) {
					this.emit("line", "") // Signal start of output
					didEmitEmptyLine = true
				}
			})

			// Handle stderr
			this.childProcess.stderr.on("data", (data) => {
				const output = data.toString()
				this.handleOutput(output, didEmitEmptyLine)
				if (!didEmitEmptyLine && output) {
					this.emit("line", "")
					didEmitEmptyLine = true
				}
			})

			// Handle process completion
			this.childProcess.on("close", (code, signal) => {
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
			this.childProcess.on("error", (error) => {
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

	handleOutput(data, _didEmitEmptyLine) {
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

	emitLines(chunk) {
		this.buffer += chunk
		let lineEndIndex
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, lineEndIndex).trimEnd()
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	emitRemainingBuffer() {
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
		this.emitRemainingBuffer()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	getUnretrievedOutput() {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return this.removeLastLineArtifacts(unretrieved)
	}

	removeLastLineArtifacts(output) {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}

	getDefaultShell() {
		if (process.platform === "win32") {
			return process.env.COMSPEC || "cmd.exe"
		} else {
			return process.env.SHELL || "/bin/bash"
		}
	}

	getShellArgs(shell, command) {
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
	terminate() {
		if (this.childProcess && !this.isCompleted) {
			console.log(`[StandaloneTerminal] Terminating process ${this.childProcess.pid}`)
			this.childProcess.kill("SIGTERM")

			// Force kill after timeout
			setTimeout(() => {
				if (!this.isCompleted) {
					console.log(`[StandaloneTerminal] Force killing process ${this.childProcess.pid}`)
					this.childProcess.kill("SIGKILL")
				}
			}, 5000)
		}
	}
}

class StandaloneTerminal {
	constructor(options = {}) {
		this.name = options.name || `Terminal ${Math.floor(Math.random() * 10000)}`
		this.processId = Promise.resolve(Math.floor(Math.random() * 100000))
		this.creationOptions = options
		this.exitStatus = undefined
		this.state = { isInteractedWith: false }
		this._cwd = options.cwd || process.cwd()
		this._shellPath = options.shellPath
		this._process = null
		this._processId = null

		// Mock shell integration for compatibility
		this.shellIntegration = {
			cwd: { fsPath: this._cwd },
			executeCommand: (_command) => {
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

	sendText(text, addNewLine = true) {
		console.log(`[StandaloneTerminal] sendText: ${text}`)

		// If we have an active process, send input to it
		if (this._process && !this._process.killed) {
			try {
				this._process.stdin.write(text + (addNewLine ? "\n" : ""))
			} catch (error) {
				console.error(`[StandaloneTerminal] Error sending text to process:`, error)
			}
		} else {
			// For compatibility with old behavior, we could spawn a new process
			console.log(`[StandaloneTerminal] No active process to send text to`)
		}
	}

	show() {
		console.log(`[StandaloneTerminal] show: ${this.name}`)
		this.state.isInteractedWith = true
	}

	hide() {
		console.log(`[StandaloneTerminal] hide: ${this.name}`)
	}

	dispose() {
		console.log(`[StandaloneTerminal] dispose: ${this.name}`)
		if (this._process && !this._process.killed) {
			this._process.kill("SIGTERM")
		}
	}
}

// Terminal registry for tracking terminals
class StandaloneTerminalRegistry {
	constructor() {
		this.terminals = new Map()
		this.nextId = 1
	}

	createTerminal(options = {}) {
		const terminal = new StandaloneTerminal(options)
		const id = this.nextId++

		const terminalInfo = {
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

	getTerminal(id) {
		return this.terminals.get(id)
	}

	getAllTerminals() {
		return Array.from(this.terminals.values())
	}

	removeTerminal(id) {
		const terminalInfo = this.terminals.get(id)
		if (terminalInfo) {
			terminalInfo.terminal.dispose()
			this.terminals.delete(id)
			console.log(`[StandaloneTerminalRegistry] Removed terminal ${id}`)
		}
	}

	updateTerminal(id, updates) {
		const terminalInfo = this.terminals.get(id)
		if (terminalInfo) {
			Object.assign(terminalInfo, updates)
		}
	}
}

// Enhanced terminal manager
class StandaloneTerminalManager {
	constructor() {
		this.registry = new StandaloneTerminalRegistry()
		this.processes = new Map()
		this.terminalIds = new Set()
		this.shellIntegrationTimeout = 4000
		this.terminalReuseEnabled = true
		this.terminalOutputLineLimit = 500
		this.defaultTerminalProfile = "default"
	}

	runCommand(terminalInfo, command) {
		console.log(`[StandaloneTerminalManager] Running command on terminal ${terminalInfo.id}: ${command}`)

		terminalInfo.busy = true
		terminalInfo.lastCommand = command

		const process = new StandaloneTerminalProcess()
		this.processes.set(terminalInfo.id, process)

		process.once("completed", () => {
			terminalInfo.busy = false
			console.log(`[StandaloneTerminalManager] Command completed on terminal ${terminalInfo.id}`)
		})

		process.once("error", (error) => {
			terminalInfo.busy = false
			console.error(`[StandaloneTerminalManager] Command error on terminal ${terminalInfo.id}:`, error)
		})

		// Create promise for the process
		const promise = new Promise((resolve, reject) => {
			process.once("continue", () => resolve())
			process.once("error", (error) => reject(error))
		})

		// Run the command immediately (no shell integration wait needed)
		process.run(terminalInfo.terminal, command)

		// Return merged promise/process object
		return this.mergePromise(process, promise)
	}

	async getOrCreateTerminal(cwd) {
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

	getTerminals(busy) {
		return Array.from(this.terminalIds)
			.map((id) => this.registry.getTerminal(id))
			.filter((t) => t && t.busy === busy)
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }))
	}

	getUnretrievedOutput(terminalId) {
		if (!this.terminalIds.has(terminalId)) {
			return ""
		}
		const process = this.processes.get(terminalId)
		return process ? process.getUnretrievedOutput() : ""
	}

	isProcessHot(terminalId) {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	processOutput(outputLines) {
		if (outputLines.length > this.terminalOutputLineLimit) {
			const halfLimit = Math.floor(this.terminalOutputLineLimit / 2)
			const start = outputLines.slice(0, halfLimit)
			const end = outputLines.slice(outputLines.length - halfLimit)
			return `${start.join("\n")}\n... (output truncated) ...\n${end.join("\n")}`.trim()
		}
		return outputLines.join("\n").trim()
	}

	disposeAll() {
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
	setShellIntegrationTimeout(timeout) {
		this.shellIntegrationTimeout = timeout
		console.log(`[StandaloneTerminalManager] Set shell integration timeout to ${timeout}ms`)
	}

	// Set terminal reuse enabled (compatibility method)
	setTerminalReuseEnabled(enabled) {
		this.terminalReuseEnabled = enabled
		console.log(`[StandaloneTerminalManager] Set terminal reuse enabled to ${enabled}`)
	}

	// Set terminal output line limit (compatibility method)
	setTerminalOutputLineLimit(limit) {
		this.terminalOutputLineLimit = limit
		console.log(`[StandaloneTerminalManager] Set terminal output line limit to ${limit}`)
	}

	// Set default terminal profile (compatibility method)
	setDefaultTerminalProfile(profile) {
		this.defaultTerminalProfile = profile
		console.log(`[StandaloneTerminalManager] Set default terminal profile to ${profile}`)
	}

	// Helper to merge process and promise (similar to execa)
	mergePromise(process, promise) {
		const nativePromisePrototype = (async () => {})().constructor.prototype
		const descriptors = ["then", "catch", "finally"].map((property) => [
			property,
			Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property),
		])

		for (const [property, descriptor] of descriptors) {
			if (descriptor) {
				const value = descriptor.value.bind(promise)
				Reflect.defineProperty(process, property, { ...descriptor, value })
			}
		}

		return process
	}
}

module.exports = {
	StandaloneTerminal,
	StandaloneTerminalProcess,
	StandaloneTerminalRegistry,
	StandaloneTerminalManager,
}
