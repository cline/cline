import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"

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
	private static terminalsPendingCleanup = new Map<number, TerminalInfo>()
	private static nextTerminalId = 1

	static createTerminal(cwd?: string | vscode.Uri | undefined, shellPath?: string): TerminalInfo {
		const terminalOptions: vscode.TerminalOptions = {
			cwd,
			name: "Cline",
			iconPath: new vscode.ThemeIcon("cline-icon"),
			env: {
				CLINE_ACTIVE: "true",
				// Override $SHELL to match the selected shell profile so that
				// child processes (make, npm scripts, etc.) that read $SHELL
				// see the correct value instead of the user's login shell.
				...(shellPath ? { SHELL: shellPath } : {}),
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

	/**
	 * Evict a terminal now and remember it for disposal at the next terminal
	 * acquisition boundary. Keeping this queue in the global registry preserves
	 * cleanup ownership across task-scoped terminal-manager replacement. If no
	 * later command needs a terminal, leave the unobservable command alone: it
	 * may still be running, and without another acquisition it cannot contribute
	 * to the terminal pile-up this queue prevents.
	 */
	static queueTerminalForCleanup(terminalInfo: TerminalInfo): void {
		TerminalRegistry.removeTerminal(terminalInfo.id)
		TerminalRegistry.terminalsPendingCleanup.set(terminalInfo.id, terminalInfo)
	}

	/** Dispose every terminal that was cleanup-eligible when this call began. */
	static disposeTerminalsPendingCleanup(): void {
		const pending = Array.from(TerminalRegistry.terminalsPendingCleanup.entries())
		for (const [id, terminalInfo] of pending) {
			// Remove ownership before dispose(), which may synchronously trigger
			// terminal-close listeners that acquire another terminal. Restore it if
			// disposal fails so the resource is never silently lost.
			TerminalRegistry.terminalsPendingCleanup.delete(id)
			try {
				terminalInfo.terminal.dispose()
			} catch (error) {
				TerminalRegistry.terminalsPendingCleanup.set(id, terminalInfo)
				Logger.warn(`[TerminalRegistry] Failed to dispose fallback terminal ${id}; cleanup will be retried`, error)
			}
		}
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
