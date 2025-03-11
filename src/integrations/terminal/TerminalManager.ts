import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

import { TERMINAL_OUTPUT_LIMIT } from "../../shared/terminal"
import { arePathsEqual } from "../../utils/path"
import { TerminalProcess } from "./TerminalProcess"
import { TerminalInfo, TerminalRegistry } from "./TerminalRegistry"
import { mergePromise, TerminalProcessResultPromise } from "./mergePromise"

/*
TerminalManager:
- Creates/reuses terminals
- Runs commands via runCommand(), returning a TerminalProcess
- Handles shell integration events

TerminalProcess extends EventEmitter and implements Promise:
- Emits 'line' events with output while promise is pending
- process.continue() resolves promise and stops event emission
- Allows real-time output handling or background execution

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
const unretrievedOutput = terminalManager.readLine(terminalId);
console.log('Unretrieved output:', unretrievedOutput);

Resources:
- https://github.com/microsoft/vscode/issues/226655
- https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api
- https://code.visualstudio.com/docs/terminal/shell-integration
- https://code.visualstudio.com/api/references/vscode-api#Terminal
- https://github.com/microsoft/vscode-extension-samples/blob/main/terminal-sample/src/extension.ts
- https://github.com/microsoft/vscode-extension-samples/blob/main/shell-integration-sample/src/extension.ts
*/

/*
The new shellIntegration API gives us access to terminal command execution output handling.
However, we don't update our VSCode type definitions or engine requirements to maintain compatibility
with older VSCode versions. Users on older versions will automatically fall back to using sendText
for terminal command execution.
Interestingly, some environments like Cursor enable these APIs even without the latest VSCode engine.
This approach allows us to leverage advanced features when available while ensuring broad compatibility.
*/
declare module "vscode" {
	// https://github.com/microsoft/vscode/blob/f0417069c62e20f3667506f4b7e53ca0004b4e3e/src/vscode-dts/vscode.d.ts#L7442
	// interface Terminal {
	// 	shellIntegration?: {
	// 		cwd?: vscode.Uri
	// 		executeCommand?: (command: string) => {
	// 			read: () => AsyncIterable<string>
	// 		}
	// 	}
	// }
	// https://github.com/microsoft/vscode/blob/f0417069c62e20f3667506f4b7e53ca0004b4e3e/src/vscode-dts/vscode.d.ts#L10794
	interface Window {
		onDidStartTerminalShellExecution?: (
			listener: (e: {
				terminal: vscode.Terminal
				execution: { read(): AsyncIterable<string>; commandLine: { value: string } }
			}) => any,
			thisArgs?: any,
			disposables?: vscode.Disposable[],
		) => vscode.Disposable
		onDidEndTerminalShellExecution?: (
			listener: (e: { terminal: vscode.Terminal; exitCode?: number; shellType?: string }) => any,
			thisArgs?: any,
			disposables?: vscode.Disposable[],
		) => vscode.Disposable
	}
}

export interface ExitCodeDetails {
	exitCode: number | undefined
	signal?: number | undefined
	signalName?: string
	coreDumpPossible?: boolean
}

export class TerminalManager {
	private terminalIds: Set<number> = new Set()
	private processes: Map<number, TerminalProcess> = new Map()
	private disposables: vscode.Disposable[] = []

	private interpretExitCode(exitCode: number | undefined): ExitCodeDetails {
		if (exitCode === undefined) {
			return { exitCode }
		}

		if (exitCode <= 128) {
			return { exitCode }
		}

		const signal = exitCode - 128
		const signals: Record<number, string> = {
			// Standard signals
			1: "SIGHUP",
			2: "SIGINT",
			3: "SIGQUIT",
			4: "SIGILL",
			5: "SIGTRAP",
			6: "SIGABRT",
			7: "SIGBUS",
			8: "SIGFPE",
			9: "SIGKILL",
			10: "SIGUSR1",
			11: "SIGSEGV",
			12: "SIGUSR2",
			13: "SIGPIPE",
			14: "SIGALRM",
			15: "SIGTERM",
			16: "SIGSTKFLT",
			17: "SIGCHLD",
			18: "SIGCONT",
			19: "SIGSTOP",
			20: "SIGTSTP",
			21: "SIGTTIN",
			22: "SIGTTOU",
			23: "SIGURG",
			24: "SIGXCPU",
			25: "SIGXFSZ",
			26: "SIGVTALRM",
			27: "SIGPROF",
			28: "SIGWINCH",
			29: "SIGIO",
			30: "SIGPWR",
			31: "SIGSYS",

			// Real-time signals base
			34: "SIGRTMIN",

			// SIGRTMIN+n signals
			35: "SIGRTMIN+1",
			36: "SIGRTMIN+2",
			37: "SIGRTMIN+3",
			38: "SIGRTMIN+4",
			39: "SIGRTMIN+5",
			40: "SIGRTMIN+6",
			41: "SIGRTMIN+7",
			42: "SIGRTMIN+8",
			43: "SIGRTMIN+9",
			44: "SIGRTMIN+10",
			45: "SIGRTMIN+11",
			46: "SIGRTMIN+12",
			47: "SIGRTMIN+13",
			48: "SIGRTMIN+14",
			49: "SIGRTMIN+15",

			// SIGRTMAX-n signals
			50: "SIGRTMAX-14",
			51: "SIGRTMAX-13",
			52: "SIGRTMAX-12",
			53: "SIGRTMAX-11",
			54: "SIGRTMAX-10",
			55: "SIGRTMAX-9",
			56: "SIGRTMAX-8",
			57: "SIGRTMAX-7",
			58: "SIGRTMAX-6",
			59: "SIGRTMAX-5",
			60: "SIGRTMAX-4",
			61: "SIGRTMAX-3",
			62: "SIGRTMAX-2",
			63: "SIGRTMAX-1",
			64: "SIGRTMAX",
		}

		// These signals may produce core dumps:
		//   SIGQUIT, SIGILL, SIGABRT, SIGBUS, SIGFPE, SIGSEGV
		const coreDumpPossible = new Set([3, 4, 6, 7, 8, 11])

		return {
			exitCode,
			signal,
			signalName: signals[signal] || `Unknown Signal (${signal})`,
			coreDumpPossible: coreDumpPossible.has(signal),
		}
	}

	constructor() {
		let startDisposable: vscode.Disposable | undefined
		let endDisposable: vscode.Disposable | undefined

		try {
			// onDidStartTerminalShellExecution
			startDisposable = (vscode.window as vscode.Window).onDidStartTerminalShellExecution?.(async (e) => {
				// Get a handle to the stream as early as possible:
				const stream = e?.execution.read()
				const terminalInfo = TerminalRegistry.getTerminalInfoByTerminal(e.terminal)

				console.info("[TerminalManager] shell execution started", {
					hasExecution: !!e?.execution,
					hasStream: !!stream,
					command: e?.execution?.commandLine?.value,
					terminalId: terminalInfo?.id,
				})

				if (terminalInfo) {
					const process = this.processes.get(terminalInfo.id)

					if (process) {
						if (stream) {
							terminalInfo.stream = stream
							terminalInfo.running = true
							terminalInfo.streamClosed = false
							console.log(`[TerminalManager] stream_available -> ${terminalInfo.id}`)
							process.emit("stream_available", terminalInfo.id, stream)
						} else {
							process.emit("stream_unavailable", terminalInfo.id)
							console.error(`[TerminalManager] stream_unavailable -> ${terminalInfo.id}`)
						}
					}
				} else {
					console.error("[TerminalManager] terminalInfo not available")
				}
			})

			// onDidEndTerminalShellExecution
			endDisposable = (vscode.window as vscode.Window).onDidEndTerminalShellExecution?.(async (e) => {
				const exitDetails = this.interpretExitCode(e?.exitCode)
				console.info("[TerminalManager] Shell execution ended:", { ...exitDetails })
				let emitted = false

				// Signal completion to any waiting processes.
				for (const id of this.terminalIds) {
					const info = TerminalRegistry.getTerminal(id)

					if (info && info.terminal === e.terminal) {
						info.running = false
						const process = this.processes.get(id)

						if (process) {
							console.log(`[TerminalManager] emitting shell_execution_complete -> ${id}`)
							emitted = true
							process.emit("shell_execution_complete", id, exitDetails)
						}

						break
					}
				}

				if (!emitted) {
					console.log(`[TerminalManager#onDidStartTerminalShellExecution] no terminal found`)
				}
			})
		} catch (error) {
			console.error("[TerminalManager] failed to configure shell execution handlers", error)
		}

		if (startDisposable) {
			this.disposables.push(startDisposable)
		}

		if (endDisposable) {
			this.disposables.push(endDisposable)
		}
	}

	runCommand(
		terminalInfo: TerminalInfo,
		command: string,
		terminalOutputLimit = TERMINAL_OUTPUT_LIMIT,
	): TerminalProcessResultPromise {
		terminalInfo.busy = true
		terminalInfo.lastCommand = command
		const process = new TerminalProcess(terminalOutputLimit)
		this.processes.set(terminalInfo.id, process)

		process.once("completed", () => {
			terminalInfo.busy = false
		})

		// if shell integration is not available, remove terminal so it does not get reused as it may be running a long-running process
		process.once("no_shell_integration", () => {
			console.log(`no_shell_integration received for terminal ${terminalInfo.id}`)
			// Remove the terminal so we can't reuse it (in case it's running a long-running process)
			TerminalRegistry.removeTerminal(terminalInfo.id)
			this.terminalIds.delete(terminalInfo.id)
			this.processes.delete(terminalInfo.id)
		})

		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => {
				resolve()
			})
			process.once("error", (error) => {
				console.error(`Error in terminal ${terminalInfo.id}:`, error)
				reject(error)
			})
		})

		// if shell integration is already active, run the command immediately
		if (terminalInfo.terminal.shellIntegration) {
			process.waitForShellIntegration = false
			process.run(terminalInfo.terminal, command)
		} else {
			// docs recommend waiting 3s for shell integration to activate
			pWaitFor(() => terminalInfo.terminal.shellIntegration !== undefined, { timeout: 4000 }).finally(() => {
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
		const terminals = TerminalRegistry.getAllTerminals()

		// Find available terminal from our pool first (created for this task)
		const matchingTerminal = terminals.find((t) => {
			if (t.busy) {
				return false
			}
			const terminalCwd = t.terminal.shellIntegration?.cwd // one of cline's commands could have changed the cwd of the terminal
			if (!terminalCwd) {
				return false
			}
			return arePathsEqual(vscode.Uri.file(cwd).fsPath, terminalCwd.fsPath)
		})
		if (matchingTerminal) {
			this.terminalIds.add(matchingTerminal.id)
			return matchingTerminal
		}

		// If no matching terminal exists, try to find any non-busy terminal
		const availableTerminal = terminals.find((t) => !t.busy)
		if (availableTerminal) {
			// Navigate back to the desired directory
			await this.runCommand(availableTerminal, `cd "${cwd}"`)
			this.terminalIds.add(availableTerminal.id)
			return availableTerminal
		}

		// If all terminals are busy, create a new one
		const newTerminalInfo = TerminalRegistry.createTerminal(cwd)
		this.terminalIds.add(newTerminalInfo.id)
		return newTerminalInfo
	}

	getTerminals(busy: boolean): { id: number; lastCommand: string }[] {
		return Array.from(this.terminalIds)
			.map((id) => TerminalRegistry.getTerminal(id))
			.filter((t): t is TerminalInfo => t !== undefined && t.busy === busy)
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }))
	}

	readLine(terminalId: number): string {
		if (!this.terminalIds.has(terminalId)) {
			return ""
		}

		const process = this.processes.get(terminalId)
		return process ? process.readLine() : ""
	}

	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	disposeAll() {
		this.terminalIds.clear()
		this.processes.clear()
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}

	/**
	 * Gets the terminal contents based on the number of commands to include
	 * @param commands Number of previous commands to include (-1 for all)
	 * @returns The selected terminal contents
	 */
	public async getTerminalContents(commands = -1): Promise<string> {
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
