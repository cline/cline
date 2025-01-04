import pWaitFor from "p-wait-for"
import * as vscode from "vscode"
import { arePathsEqual } from "../../utils/path"
import { mergePromise, TerminalProcess, TerminalProcessResultPromise } from "./TerminalProcess"
import { TerminalInfo, TerminalRegistry } from "./TerminalRegistry"

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
// No need to redefine the Window interface here

export class TerminalManager {
	private terminalIds: Set<number> = new Set()
	private processes: Map<number, TerminalProcess> = new Map()
	private disposables: vscode.Disposable[] = []
	private _onDidStartTerminalShellExecution = new vscode.EventEmitter<{
		terminal: vscode.Terminal;
		shellIntegration: any;
		execution: any;
	}>();

	private _onDidEndTerminalShellExecution = new vscode.EventEmitter<{
		terminal: vscode.Terminal;
		shellIntegration: any;
		execution: any;
		exitCode: number | undefined;
	}>();

	constructor() {
		let disposable: vscode.Disposable | undefined
		try {
			disposable = vscode.window.onDidStartTerminalShellExecution?.(
				async (e: { execution: { read: () => AsyncIterable<string> } }) => {
					// Creating a read stream here results in a more consistent output. This is most obvious when running the `date` command.
					e?.execution?.read()
				},
			)
		} catch (error) {
			// console.error("Error setting up onDidEndTerminalShellExecution", error)
		}
		if (disposable) {
			this.disposables.push(disposable)
		}
	}

	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise {
		console.log(`runCommand - Start: terminal id: ${terminalInfo.id}, command: ${command}`)
		terminalInfo.busy = true
		terminalInfo.lastCommand = command
		const process = new TerminalProcess()
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
			console.log(`runCommand - Shell integration detected`)
			const execution = terminalInfo.terminal.shellIntegration.executeCommand(command)
			console.log(`runCommand - Command executed, execution: ${execution}`)
			this._onDidStartTerminalShellExecution.fire({
				terminal: terminalInfo.terminal,
				shellIntegration: terminalInfo.terminal.shellIntegration,
				execution,
			})
			execution.exitCode
				.then((exitCode) => {
					console.log(`runCommand - Command finished, exit code: ${exitCode}`)
					this._onDidEndTerminalShellExecution.fire({
						terminal: terminalInfo.terminal,
						shellIntegration: terminalInfo.terminal.shellIntegration!,
						execution,
						exitCode,
					})
				})
				.catch((e) => {
					console.error(`runCommand - Command failed: ${e}`)
					this._onDidEndTerminalShellExecution.fire({
						terminal: terminalInfo.terminal,
						shellIntegration: terminalInfo.terminal.shellIntegration!,
						execution,
						exitCode: undefined,
					})
				})
		} else {
			console.log(`runCommand - No shell integration detected`)
			terminalInfo.terminal.sendText(command)
			console.log(`runCommand - Command sent via sendText: ${command}`)
			this.removeTerminal(terminalInfo.id)
			console.log(`runCommand - Terminal removed: ${terminalInfo.id}`)
		}
		console.log(`runCommand - End`)

		return mergePromise(process, promise)
	}

	async getOrCreateTerminal(cwd: string): Promise<TerminalInfo> {
		console.log(`getOrCreateTerminal - Start: cwd: ${cwd}`)
		// Find available terminal from our pool first (created for this task)
		const availableTerminal = TerminalRegistry.getAllTerminals().find((t) => {
			if (t.busy) {
				return false
			}

			// If no shellIntegration, cannot compare paths
			const terminalCwd = t.terminal.shellIntegration?.cwd
			if (!terminalCwd) {
				return false
			}

			try {
				// Safely convert cwd to a file URI and get its path
				const cwdUri = vscode.Uri.file(cwd)
				return arePathsEqual(cwdUri.fsPath, terminalCwd.fsPath)
			} catch (error) {
				// If path conversion fails, return false
				console.warn(`Failed to compare paths: ${error}`)
				return false
			}
		})

		if (availableTerminal) {
			this.terminalIds.add(availableTerminal.id)
			return availableTerminal
		}

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

	disposeAll() {
		// for (const info of this.terminals) {
		// 	//info.terminal.dispose() // dont want to dispose terminals when task is aborted
		// }
		this.terminalIds.clear()
		this.processes.clear()
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}
}
