import * as vscode from "vscode"

export interface TerminalInfo {
	terminal: vscode.Terminal
	busy: boolean
	lastCommand: string
	id: number
	shellPath?: string
	lastActive: number
	pendingCwdChange?: string
	cwdResolved?: {
		resolve: () => void
		reject: (error: Error) => void
	}
}

// Although vscode.window.terminals provides a list of all open terminals, there's no way to know whether they're busy or not (exitStatus does not provide useful information for most commands). In order to prevent creating too many terminals, we need to keep track of terminals through the life of the extension, as well as session specific terminals for the life of a task (to get latest unretrieved output).
// Since we have promises keeping track of terminal processes, we get the added benefit of keep track of busy terminals even after a task is closed.
export class TerminalRegistry {
	private static terminals: TerminalInfo[] = []
	private static nextTerminalId = 1

	static createTerminal(cwd?: string | vscode.Uri | undefined, shellPath?: string): TerminalInfo {
		const terminalOptions: vscode.TerminalOptions = {
			cwd,
			name: "Cline",
			iconPath: new vscode.ThemeIcon("cline-icon"),
			env: {
				CLINE_ACTIVE: "true",
			},
		}

		// If a specific shell path is provided, use it
		if (shellPath) {
			terminalOptions.shellPath = shellPath
		}

		const terminal = vscode.window.createTerminal(terminalOptions)
		TerminalRegistry.nextTerminalId++
		const newInfo: TerminalInfo = {
			terminal,
			busy: false,
			lastCommand: "",
			id: TerminalRegistry.nextTerminalId,
			shellPath,
			lastActive: Date.now(),
		}
		TerminalRegistry.terminals.push(newInfo)
		return newInfo
	}

	static getTerminal(id: number): TerminalInfo | undefined {
		const terminalInfo = TerminalRegistry.terminals.find((t) => t.id === id)
		if (terminalInfo && TerminalRegistry.isTerminalClosed(terminalInfo.terminal)) {
			TerminalRegistry.removeTerminal(id)
			return undefined
		}
		return terminalInfo
	}

	static updateTerminal(id: number, updates: Partial<TerminalInfo>) {
		const terminal = TerminalRegistry.getTerminal(id)
		if (terminal) {
			Object.assign(terminal, updates)
		}
	}

	static removeTerminal(id: number) {
		TerminalRegistry.terminals = TerminalRegistry.terminals.filter((t) => t.id !== id)
	}

	static getAllTerminals(): TerminalInfo[] {
		TerminalRegistry.terminals = TerminalRegistry.terminals.filter((t) => !TerminalRegistry.isTerminalClosed(t.terminal))
		return TerminalRegistry.terminals
	}

	// The exit status of the terminal will be undefined while the terminal is active. (This value is set when onDidCloseTerminal is fired.)
	private static isTerminalClosed(terminal: vscode.Terminal): boolean {
		return terminal.exitStatus !== undefined
	}
}
