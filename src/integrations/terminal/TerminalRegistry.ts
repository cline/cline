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
	private static terminals: TerminalInfo[] = [];
	private static nextTerminalId = 1;

	static createTerminal(cwd?: string | vscode.Uri | undefined): TerminalInfo {
		console.log(`Creating terminal with cwd: ${cwd}`);
		const terminal = vscode.window.createTerminal({
			cwd,
			name: "Cline",
			iconPath: new vscode.ThemeIcon("robot"),
		});
		const newInfo: TerminalInfo = {
			terminal: terminal,
			busy: false,
			lastCommand: "",
			id: this.nextTerminalId++,
		};
		this.terminals.push(newInfo);
		console.log(`New terminal created: ${newInfo}`);
		return newInfo;
	}

	static getTerminal(id: number): TerminalInfo | undefined {
		console.log(`Getting terminal with id: ${id}`);
		const terminalInfo = this.terminals.find((t) => t.id === id);
		console.log(`Found terminal: ${terminalInfo}`);
		if (terminalInfo && this.isTerminalClosed(terminalInfo.terminal)) {
			console.log(`Terminal is closed, removing: ${terminalInfo}`);
			this.removeTerminal(id);
			return undefined;
		}
		return terminalInfo;
	}

	static updateTerminal(id: number, updates: Partial<TerminalInfo>) {
		console.log(`Updating terminal with id: ${id}, updates: ${JSON.stringify(updates)}`);
		const terminal = this.getTerminal(id);
		if (terminal) {
			Object.assign(terminal, updates);
			console.log(`Terminal updated: ${JSON.stringify(terminal)}`);
		}
	}

	static removeTerminal(id: number) {
		console.log(`Removing terminal with id: ${id}`);
		this.terminals = this.terminals.filter((t) => t.id !== id);
		console.log(`Remaining terminals: ${this.terminals.map(t => t.id).join(", ")}`);
	}

	static getAllTerminals(): TerminalInfo[] {
		console.log(`Getting all terminals`);
		this.terminals = this.terminals.filter((t) => !this.isTerminalClosed(t.terminal));
		console.log(`Filtered terminals: ${this.terminals.map(t => t.id).join(", ")}`);
		return this.terminals;
	}

	static getNextTerminalId(): number {
		return this.nextTerminalId++;
	}

	// The exit status of the terminal will be undefined while the terminal is active. (This value is set when onDidCloseTerminal is fired.)
	private static isTerminalClosed(terminal: vscode.Terminal): boolean {
		return terminal.exitStatus !== undefined;
	}
}
