import pWaitFor from "p-wait-for"
import * as vscode from "vscode"
import { arePathsEqual } from "../../utils/path"
import { ExitCodeDetails, mergePromise, TerminalProcess, TerminalProcessResultPromise } from "./TerminalProcess"
import { Terminal } from "./Terminal"
import { TerminalRegistry } from "./TerminalRegistry"

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
			listener: (e: any) => any,
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

export class TerminalManager {
	private terminalIds: Set<number> = new Set()
	private disposables: vscode.Disposable[] = []

	constructor() {
		let startDisposable: vscode.Disposable | undefined
		let endDisposable: vscode.Disposable | undefined
		try {
			// onDidStartTerminalShellExecution
			startDisposable = (vscode.window as vscode.Window).onDidStartTerminalShellExecution?.(async (e) => {
				// Get a handle to the stream as early as possible:
				const stream = e?.execution.read()
				const terminalInfo = TerminalRegistry.getTerminalByVSCETerminal(e.terminal)
				if (terminalInfo) {
					terminalInfo.setActiveStream(stream)
				} else {
					console.error("[TerminalManager] Stream failed, not registered for terminal")
				}

				console.info("[TerminalManager] Shell execution started:", {
					hasExecution: !!e?.execution,
					command: e?.execution?.commandLine?.value,
					terminalId: terminalInfo?.id,
				})
			})

			// onDidEndTerminalShellExecution
			endDisposable = (vscode.window as vscode.Window).onDidEndTerminalShellExecution?.(async (e) => {
				const terminalInfo = TerminalRegistry.getTerminalByVSCETerminal(e.terminal)
				const process = terminalInfo?.process
				const exitDetails = process ? TerminalProcess.interpretExitCode(e?.exitCode) : { exitCode: e?.exitCode }
				console.info("[TerminalManager] Shell execution ended:", {
					...exitDetails,
				})

				// Signal completion to any waiting processes
				if (terminalInfo && this.terminalIds.has(terminalInfo.id)) {
					terminalInfo.shellExecutionComplete(exitDetails)
				}
			})
		} catch (error) {
			console.error("[TerminalManager] Error setting up shell execution handlers:", error)
		}
		if (startDisposable) {
			this.disposables.push(startDisposable)
		}
		if (endDisposable) {
			this.disposables.push(endDisposable)
		}
	}

	runCommand(terminalInfo: Terminal, command: string): TerminalProcessResultPromise {
		terminalInfo.busy = true
		terminalInfo.lastCommand = command

		// Create process immediately
		const process = new TerminalProcess(terminalInfo)

		// Set process on terminal
		terminalInfo.process = process

		// Create a promise for command completion
		const promise = new Promise<void>((resolve, reject) => {
			// Set up event handlers
			process.once("continue", () => resolve())
			process.once("error", (error) => {
				console.error(`Error in terminal ${terminalInfo.id}:`, error)
				reject(error)
			})

			// Wait for shell integration before executing the command
			pWaitFor(() => terminalInfo.terminal.shellIntegration !== undefined, { timeout: 4000 })
				.then(() => {
					process.run(command)
				})
				.catch(() => {
					console.log("[TerminalManager] Shell integration not available. Command execution aborted.")
					process.emit("no_shell_integration")
				})
		})

		return mergePromise(process, promise)
	}

	async getOrCreateTerminal(cwd: string): Promise<Terminal> {
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

	disposeAll() {
		// for (const info of this.terminals) {
		// 	//info.terminal.dispose() // dont want to dispose terminals when task is aborted
		// }
		this.terminalIds.clear()
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}
}
