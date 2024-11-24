import * as vscode from "vscode"

export interface TerminalInfo {
	terminal: vscode.Terminal
	busy: boolean
	lastCommand: string
	id: number
}

// Although vscode.window.terminals provides a list of all open terminals, there's no way to know whether they're busy or not (exitStatus does not provide useful information for most commands). In order to prevent creating too many terminals, we need to keep track of terminals through the life of the extension, as well as session specific terminals for the life of a task (to get latest unretrieved output).
// Since we have promises keeping track of terminal processes, we get the added benefit of keep track of busy terminals even after a task is closed.
export class TerminalRegistry {
	private static terminals: TerminalInfo[] = []
	private static nextTerminalId = 1

	static createTerminal(cwd?: string | vscode.Uri | undefined): TerminalInfo {
		// Get the default shell profile
		const defaultProfile = vscode.env.shell;
		
		// Create terminal with explicit shell integration
		const terminal = vscode.window.createTerminal({
			cwd,
			name: "Cline",
			iconPath: new vscode.ThemeIcon("robot"),
			shellPath: defaultProfile, // Use the default shell
			// Explicitly enable shell integration
			env: {
				TERM_PROGRAM: "vscode",
			},
		})

		// Show the terminal to ensure it's initialized
		terminal.show(false) // false means don't focus

		const newInfo: TerminalInfo = {
			terminal,
			busy: false,
			lastCommand: "",
			id: this.nextTerminalId++,
		}
		this.terminals.push(newInfo)
		return newInfo
	}

	static getTerminal(id: number): TerminalInfo | undefined {
		const terminalInfo = this.terminals.find((t) => t.id === id)
		if (terminalInfo && this.isTerminalClosed(terminalInfo.terminal)) {
			this.removeTerminal(id)
			return undefined
		}
		return terminalInfo
	}

	static updateTerminal(id: number, updates: Partial<TerminalInfo>) {
		const terminal = this.getTerminal(id)
		if (terminal) {
			Object.assign(terminal, updates)
		}
	}

	static removeTerminal(id: number) {
		this.terminals = this.terminals.filter((t) => t.id !== id)
	}

	static getAllTerminals(): TerminalInfo[] {
		// First, remove any closed terminals from our registry
		this.terminals = this.terminals.filter((t) => !this.isTerminalClosed(t.terminal))

		// Get all VSCode terminals
		const vscodeTerminals = vscode.window.terminals

		// Add any VSCode terminals that aren't in our registry
		vscodeTerminals.forEach(terminal => {
			const exists = this.terminals.some(t => t.terminal === terminal)
			if (!exists) {
				// Show the terminal briefly to ensure it's initialized
				terminal.show(false) // false means don't focus
				
				this.terminals.push({
					terminal,
					busy: false,
					lastCommand: terminal.name || "",
					id: this.nextTerminalId++
				})
			}
		})

		// Remove any terminals that no longer exist in VSCode
		this.terminals = this.terminals.filter(t => 
			vscodeTerminals.some(vt => vt === t.terminal)
		)

		return this.terminals
	}

	// The exit status of the terminal will be undefined while the terminal is active. (This value is set when onDidCloseTerminal is fired.)
	private static isTerminalClosed(terminal: vscode.Terminal): boolean {
		return terminal.exitStatus !== undefined
	}

	// Helper method to ensure shell integration is ready
	static async ensureShellIntegration(terminal: vscode.Terminal): Promise<boolean> {
		// If shell integration is already available, return true
		if (terminal.shellIntegration?.executeCommand) {
			return true
		}

		// Show the terminal to ensure it's initialized
		terminal.show(false)

		// Wait for shell integration to become available
		return new Promise((resolve) => {
			let attempts = 0
			const maxAttempts = 10
			const interval = setInterval(() => {
				attempts++
				if (terminal.shellIntegration?.executeCommand) {
					clearInterval(interval)
					resolve(true)
				} else if (attempts >= maxAttempts) {
					clearInterval(interval)
					resolve(false)
				}
			}, 500) // Check every 500ms
		})
	}

	// Helper method to check if a terminal has shell integration
	static hasShellIntegration(terminal: vscode.Terminal): boolean {
		return terminal.shellIntegration?.executeCommand !== undefined
	}
}
