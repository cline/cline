import * as vscode from "vscode"

export interface TerminalInfo {
	terminal: vscode.Terminal
	busy: boolean
	lastCommand: string
	id: number
	serverType?: string
	serverFramework?: string
	serverUrl?: string
	task?: string
}

export class TerminalRegistry {
	private static terminals: TerminalInfo[] = []
	private static nextTerminalId = 1

	static createTerminal(cwd?: string | vscode.Uri | undefined, task?: string): TerminalInfo {
		// Get the default shell profile
		const defaultProfile = vscode.env.shell;
		
		// Prepare terminal options
		const terminalOptions: vscode.TerminalOptions = {
			name: "Cline",
			shellPath: defaultProfile, // Use the default shell
			env: {
				TERM_PROGRAM: "vscode",
				// Set task environment variable
				...(task ? { VSCODE_TASK: task } : {})
			}
		}

		// Conditionally add working directory if provided
		if (cwd) {
			terminalOptions.cwd = typeof cwd === 'string' 
				? vscode.Uri.file(cwd) 
				: cwd
		}

		// Create terminal with explicit shell integration
		const terminal = vscode.window.createTerminal(terminalOptions)

		// Show the terminal to ensure it's initialized
		terminal.show(false) // false means don't focus

		const newInfo: TerminalInfo = {
			terminal,
			busy: false,
			lastCommand: "",
			id: this.nextTerminalId++,
			task: task || "Cline"
		}
		this.terminals.push(newInfo)
		return newInfo
	}

	static updateTerminalServerInfo(id: number, serverInfo: {
		type?: string, 
		framework?: string, 
		url?: string
	}) {
		const terminal = this.getTerminal(id)
		if (terminal) {
			terminal.serverType = serverInfo.type
			terminal.serverFramework = serverInfo.framework
			terminal.serverUrl = serverInfo.url

			// Update task if server info is available
			if (serverInfo.framework || serverInfo.type) {
				const taskName = `${serverInfo.framework || serverInfo.type} Dev Server`
				terminal.task = taskName

				// Update terminal environment to reflect the task
				try {
					// Modify terminal environment to set task
					terminal.terminal.processId.then(pid => {
						if (pid) {
							// Note: This is a best-effort approach as directly modifying 
							// running terminal environment is challenging
							vscode.workspace.getConfiguration().update(
								'terminal.integrated.env.linux', 
								{ VSCODE_TASK: taskName },
								vscode.ConfigurationTarget.Global
							)
						}
					})
				} catch (error) {
					console.error("Error updating terminal task:", error)
				}
			}
		}
	}

	// Rest of the implementation remains similar to previous version
	static getTerminal(id: number): TerminalInfo | undefined {
		const terminalInfo = this.terminals.find((t) => t.id === id)
		if (terminalInfo && this.isTerminalClosed(terminalInfo.terminal)) {
			this.removeTerminal(id)
			return undefined
		}
		return terminalInfo
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
					id: this.nextTerminalId++,
					task: "Cline"
				})
			}
		})

		// Remove any terminals that no longer exist in VSCode
		this.terminals = this.terminals.filter(t => 
			vscodeTerminals.some(vt => vt === t.terminal)
		)

		return this.terminals
	}

	// Existing helper methods remain the same
	private static isTerminalClosed(terminal: vscode.Terminal): boolean {
		return terminal.exitStatus !== undefined
	}

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

	static hasShellIntegration(terminal: vscode.Terminal): boolean {
		return terminal.shellIntegration?.executeCommand !== undefined
	}
}
