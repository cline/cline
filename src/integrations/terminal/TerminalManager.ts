import pWaitFor from "p-wait-for"
import * as vscode from "vscode"
import { arePathsEqual } from "../../utils/path"
import { mergePromise, TerminalProcess, TerminalProcessResultPromise } from "./TerminalProcess"
import { TerminalInfo, TerminalRegistry } from "./TerminalRegistry"

declare module "vscode" {
	interface Terminal {
		shellIntegration?: {
			cwd?: vscode.Uri
			executeCommand?: (command: string) => {
				read: () => AsyncIterable<string>
			}
		}
	}
	interface Window {
		onDidStartTerminalShellExecution?: (
			listener: (e: any) => any,
			thisArgs?: any,
			disposables?: vscode.Disposable[]
		) => vscode.Disposable
	}
}

export interface ReadyInfo {
    type: string;
    url?: string;
    framework?: string;
    terminalId: number;
}

interface TerminalOutput {
    id: number;
    lastCommand: string;
    type?: string;
    framework?: string;
    url?: string;
    displayName?: string;
    recentOutput?: string[];
    commandHistory?: string[];
}

interface TerminalState {
    process: TerminalProcess;
    outputLines: string[];
    commandHistory: string[];
    lastActivity: number;
}

const MAX_OUTPUT_LINES = 10;
const MAX_COMMAND_HISTORY = 5;

export class TerminalManager {
	private terminalIds: Set<number> = new Set()
	private processes: Map<number, TerminalState> = new Map()
	private disposables: vscode.Disposable[] = []
	private readyCallback?: (info: ReadyInfo) => void

	constructor() {
		let disposable: vscode.Disposable | undefined
		try {
			disposable = (vscode.window as vscode.Window).onDidStartTerminalShellExecution?.(async (e) => {
				e?.execution?.read()
			})
		} catch (error) {
			// Ignore error setting up onDidEndTerminalShellExecution
		}
		if (disposable) {
			this.disposables.push(disposable)
		}
	}

	onReady(callback: (info: ReadyInfo) => void) {
		this.readyCallback = callback
	}

	private updateTerminalState(terminalId: number, output: string, command?: string) {
		let state = this.processes.get(terminalId)
		if (!state) {
			state = {
				process: new TerminalProcess(),
				outputLines: [],
				commandHistory: [],
				lastActivity: Date.now()
			}
			this.processes.set(terminalId, state)
		}

		// Update output lines
		if (output.trim()) {
			const lines = output.split('\n').filter(line => line.trim());
			state.outputLines.push(...lines);
			// Keep only the last N lines
			if (state.outputLines.length > MAX_OUTPUT_LINES) {
				state.outputLines = state.outputLines.slice(-MAX_OUTPUT_LINES);
			}
		}

		// Update command history
		if (command) {
			state.commandHistory.push(command);
			if (state.commandHistory.length > MAX_COMMAND_HISTORY) {
				state.commandHistory = state.commandHistory.slice(-MAX_COMMAND_HISTORY);
			}
		}

		state.lastActivity = Date.now();
	}

	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise {
		terminalInfo.busy = true
		terminalInfo.lastCommand = command

		// Get or create terminal state
		let state = this.processes.get(terminalInfo.id)
		if (!state) {
			state = {
				process: new TerminalProcess(),
				outputLines: [],
				commandHistory: [],
				lastActivity: Date.now()
			}
			this.processes.set(terminalInfo.id, state)
		}

		// Update command history
		this.updateTerminalState(terminalInfo.id, '', command)

		// Handle ready event with server information
		state.process.on("ready", (info) => {
			// Update terminal registry with server information
			TerminalRegistry.updateTerminalServerInfo(terminalInfo.id, {
				type: info.type,
				framework: info.framework,
				url: info.url
			})
			
			if (this.readyCallback) {
				this.readyCallback({
					...info,
					terminalId: terminalInfo.id
				})
			}
		})

		// Handle line output
		state.process.on("line", (line) => {
			this.updateTerminalState(terminalInfo.id, line)
		})

		state.process.once("completed", () => {
			terminalInfo.busy = false
		})

		state.process.once("no_shell_integration", () => {
			console.log(`Shell integration not available for terminal ${terminalInfo.id}`)
		})

		const promise = new Promise<void>((resolve, reject) => {
			state?.process.once("continue", () => {
				resolve()
			})
			state?.process.once("error", (error) => {
				console.error(`Error in terminal ${terminalInfo.id}:`, error)
				reject(error)
			})
		})

		// Initialize shell integration check
		TerminalRegistry.ensureShellIntegration(terminalInfo.terminal).then(hasShellIntegration => {
			state!.process.waitForShellIntegration = false
			state!.process.run(terminalInfo.terminal, command)
		})

		return mergePromise(state.process, promise)
	}

	async getOrCreateTerminal(cwd: string, terminalId?: number): Promise<TerminalInfo> {
		// Find available terminal from our pool first (created for this task)
		const availableTerminal = TerminalRegistry.getAllTerminals().find((t) => {
			if (t.busy) {
				return false
			}
			const terminalCwd = t.terminal.shellIntegration?.cwd
			if (!terminalCwd) {
				return false
			}
			return arePathsEqual(vscode.Uri.file(cwd).fsPath, terminalCwd.fsPath)
		})
		if (availableTerminal) {
			this.terminalIds.add(availableTerminal.id)
			return availableTerminal
		}

		// If a specific terminal ID is provided, try to reuse it
		if (terminalId !== undefined) {
			const existingTerminal = TerminalRegistry.getTerminal(terminalId)
			if (existingTerminal) {
				await TerminalRegistry.ensureShellIntegration(existingTerminal.terminal)
				this.terminalIds.add(existingTerminal.id)
				return existingTerminal
			}
		}

		// Create a new terminal if no suitable existing terminal is found
		const newTerminalInfo = TerminalRegistry.createTerminal(cwd)
		await TerminalRegistry.ensureShellIntegration(newTerminalInfo.terminal)
		this.terminalIds.add(newTerminalInfo.id)
		return newTerminalInfo
	}

    getTerminals(busy: boolean): TerminalOutput[] {
        const allTerminals = TerminalRegistry.getAllTerminals();
        allTerminals.forEach(t => this.terminalIds.add(t.id));

        return Array.from(this.terminalIds)
            .map((id): TerminalOutput | null => {
                const terminal = TerminalRegistry.getTerminal(id)
                const state = this.processes.get(id)
                if (!terminal || terminal.busy !== busy) return null

                return {
                    id: terminal.id,
                    lastCommand: terminal.lastCommand,
                    type: terminal.serverType,
                    framework: terminal.serverFramework,
                    url: terminal.serverUrl,
                    displayName: terminal.task,
                    recentOutput: state?.outputLines.slice(-MAX_OUTPUT_LINES),
                    commandHistory: state?.commandHistory.slice(-MAX_COMMAND_HISTORY)
                }
            })
            .filter((t): t is TerminalOutput => t !== null)
    }

	getUnretrievedOutput(terminalId: number): string {
		if (!this.terminalIds.has(terminalId)) {
			return ""
		}
		const state = this.processes.get(terminalId)
		return state?.process.getUnretrievedOutput() || ""
	}

	isProcessHot(terminalId: number): boolean {
		const state = this.processes.get(terminalId)
		return state?.process.isHot || false
	}

	disposeAll() {
		// Only dispose the disposables, keep terminals alive
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}
}
