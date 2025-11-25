import * as vscode from "vscode"
import { stripAnsi } from "./ansiUtils"

interface CommandHistoryItem {
	commandLine: string
	cwd?: string
	exitCode?: number
	output: string
	startTime: number
	endTime?: number
}

interface CommandInfo {
	commandLine: string
	cwd?: string
	exitCode?: number
	cleanOutput: string
	duration: number
	timestamp: Date
}

/**
 * Tracks terminal command execution history using VSCode's shell integration API.
 * Listens for command start/end events and maintains a history of recent commands per terminal.
 */
export class CommandHistoryTracker {
	private commandHistory = new Map<vscode.Terminal, CommandHistoryItem[]>()
	private readonly maxHistoryPerTerminal = 20
	private disposables: vscode.Disposable[] = []
	private onHistoryChangedCallback?: () => void

	constructor(onHistoryChanged?: () => void) {
		this.onHistoryChangedCallback = onHistoryChanged
		this.setupEventListeners()
	}

	private setupEventListeners(): void {
		// Track command start
		try {
			const onStartExecution = (vscode.window as any).onDidStartTerminalShellExecution
			if (onStartExecution) {
				this.disposables.push(
					onStartExecution((event: any) => {
						this.handleCommandStart(event)
					}),
				)
			}
		} catch (error) {
			console.log("Shell execution tracking not available:", error)
		}

		// Track command end
		try {
			const onEndExecution = (vscode.window as any).onDidEndTerminalShellExecution
			if (onEndExecution) {
				this.disposables.push(
					onEndExecution((event: any) => {
						this.handleCommandEnd(event)
					}),
				)
			}
		} catch (error) {
			console.log("Shell execution end tracking not available:", error)
		}

		// Clean up when terminal closes
		this.disposables.push(
			vscode.window.onDidCloseTerminal((terminal) => {
				this.commandHistory.delete(terminal)
			}),
		)
	}

	private handleCommandStart(event: any): void {
		if (!this.commandHistory.has(event.terminal)) {
			this.commandHistory.set(event.terminal, [])
		}

		const history = this.commandHistory.get(event.terminal)!
		const item: CommandHistoryItem = {
			commandLine: event.execution.commandLine.value,
			cwd: event.execution.cwd?.fsPath,
			exitCode: undefined,
			output: "",
			startTime: Date.now(),
			endTime: undefined,
		}

		history.push(item)

		// Keep only last N commands per terminal
		if (history.length > this.maxHistoryPerTerminal) {
			history.shift()
		}

		// Notify that history changed
		this.onHistoryChangedCallback?.()
		// Collect output asynchronously
		;(async () => {
			try {
				for await (const data of event.execution.read()) {
					item.output += data
				}
			} catch (e) {
				console.error("Error reading command output:", e)
			}
		})()
	}

	private handleCommandEnd(event: any): void {
		const history = this.commandHistory.get(event.terminal)
		if (history && history.length > 0) {
			const lastItem = history[history.length - 1]
			if (lastItem.commandLine === event.execution.commandLine.value) {
				lastItem.exitCode = event.exitCode
				lastItem.endTime = Date.now()
			}
		}
	}

	/**
	 * Get the most recent command from a terminal's history
	 */
	public getLatestCommand(terminal: vscode.Terminal): CommandInfo | undefined {
		const history = this.commandHistory.get(terminal)
		if (!history || history.length === 0) {
			return undefined
		}

		const lastCommand = history[history.length - 1]

		return {
			commandLine: lastCommand.commandLine,
			cwd: lastCommand.cwd,
			exitCode: lastCommand.exitCode,
			cleanOutput: stripAnsi(lastCommand.output),
			duration: lastCommand.endTime ? lastCommand.endTime - lastCommand.startTime : Date.now() - lastCommand.startTime,
			timestamp: new Date(lastCommand.startTime),
		}
	}

	/**
	 * Check if a terminal has any command history
	 */
	public hasHistory(terminal: vscode.Terminal): boolean {
		const history = this.commandHistory.get(terminal)
		return history !== undefined && history.length > 0
	}

	/**
	 * Get all commands for a terminal
	 */
	public getHistory(terminal: vscode.Terminal): CommandInfo[] {
		const history = this.commandHistory.get(terminal)
		if (!history) {
			return []
		}

		return history.map((item) => ({
			commandLine: item.commandLine,
			cwd: item.cwd,
			exitCode: item.exitCode,
			cleanOutput: stripAnsi(item.output),
			duration: item.endTime ? item.endTime - item.startTime : Date.now() - item.startTime,
			timestamp: new Date(item.startTime),
		}))
	}

	/**
	 * Clean up resources
	 */
	public dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.commandHistory.clear()
	}
}
