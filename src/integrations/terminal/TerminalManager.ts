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
    terminalId: number;
}

interface TerminalOutput {
    id: number;
    lastCommand: string;
    type?: string;
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
	private terminalTypes: Map<number, string> = new Map()

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

		// Handle ready event
		state.process.on("ready", (info) => {
			this.terminalTypes.set(terminalInfo.id, info.type)
			
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
			
			if (!state?.process.isHot) {
				setTimeout(() => {
					terminalInfo.terminal.dispose()
					TerminalRegistry.removeTerminal(terminalInfo.id)
					this.terminalIds.delete(terminalInfo.id)
					this.processes.delete(terminalInfo.id)
					this.terminalTypes.delete(terminalInfo.id)
				}, 1000)
			}
		})

		state.process.once("no_shell_integration", () => {
			const type = this.terminalTypes.get(terminalInfo.id)
			if (!state?.process.isHot && !type?.includes('server')) {
				console.log(`Removing terminal ${terminalInfo.id} due to no shell integration after retries`)
				TerminalRegistry.removeTerminal(terminalInfo.id)
				this.terminalIds.delete(terminalInfo.id)
				this.processes.delete(terminalInfo.id)
				this.terminalTypes.delete(terminalInfo.id)
			}
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
		if (terminalId !== undefined) {
			const existingTerminal = TerminalRegistry.getTerminal(terminalId)
			if (existingTerminal) {
				await TerminalRegistry.ensureShellIntegration(existingTerminal.terminal)
				this.terminalIds.add(existingTerminal.id)
				return existingTerminal
			}
		}

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
                    type: this.terminalTypes.get(id),
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
		const terminalsToDispose = Array.from(this.terminalIds)
			.filter(id => {
				const state = this.processes.get(id)
				const type = this.terminalTypes.get(id)
				return !state?.process.isHot && !type?.includes('server')
			})
		
		for (const id of terminalsToDispose) {
			const terminalInfo = TerminalRegistry.getTerminal(id)
			if (terminalInfo) {
				terminalInfo.terminal.dispose()
			}
			TerminalRegistry.removeTerminal(id)
			this.terminalIds.delete(id)
			this.processes.delete(id)
			this.terminalTypes.delete(id)
		}

		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}
}
