import * as vscode from "vscode"
import { Terminal } from "./Terminal"

// Although vscode.window.terminals provides a list of all open terminals, there's no way to know whether they're busy or not (exitStatus does not provide useful information for most commands). In order to prevent creating too many terminals, we need to keep track of terminals through the life of the extension, as well as session specific terminals for the life of a task (to get latest unretrieved output).
// Since we have promises keeping track of terminal processes, we get the added benefit of keep track of busy terminals even after a task is closed.
export class TerminalRegistry {
	private static terminals: Terminal[] = []
	private static nextTerminalId = 1

	static createTerminal(cwd?: string | vscode.Uri | undefined): Terminal {
		const terminal = vscode.window.createTerminal({
			cwd,
			name: "Roo Code",
			iconPath: new vscode.ThemeIcon("rocket"),
			env: {
				PAGER: "cat",

				// VSCode bug#237208: Command output can be lost due to a race between completion
				// sequences and consumers. Add 50ms delay via PROMPT_COMMAND to ensure the
				// \x1b]633;D escape sequence arrives after command output is processed.
				PROMPT_COMMAND: "sleep 0.050",

				// VTE must be disabled because it prevents the prompt command above from executing
				// See https://wiki.gnome.org/Apps/Terminal/VTE
				VTE_VERSION: "0",
			},
		})

		const newTerminal = new Terminal(this.nextTerminalId++, terminal)

		this.terminals.push(newTerminal)
		return newTerminal
	}

	static getTerminal(id: number): Terminal | undefined {
		const terminalInfo = this.terminals.find((t) => t.id === id)

		if (terminalInfo && this.isTerminalClosed(terminalInfo.terminal)) {
			this.removeTerminal(id)
			return undefined
		}

		return terminalInfo
	}

	static updateTerminal(id: number, updates: Partial<Terminal>) {
		const terminal = this.getTerminal(id)

		if (terminal) {
			Object.assign(terminal, updates)
		}
	}

	static getTerminalInfoByTerminal(terminal: vscode.Terminal): Terminal | undefined {
		const terminalInfo = this.terminals.find((t) => t.terminal === terminal)

		if (terminalInfo && this.isTerminalClosed(terminalInfo.terminal)) {
			this.removeTerminal(terminalInfo.id)
			return undefined
		}

		return terminalInfo
	}

	static removeTerminal(id: number) {
		this.terminals = this.terminals.filter((t) => t.id !== id)
	}

	static getAllTerminals(): Terminal[] {
		this.terminals = this.terminals.filter((t) => !this.isTerminalClosed(t.terminal))
		return this.terminals
	}

	// The exit status of the terminal will be undefined while the terminal is active. (This value is set when onDidCloseTerminal is fired.)
	private static isTerminalClosed(terminal: vscode.Terminal): boolean {
		return terminal.exitStatus !== undefined
	}
}
