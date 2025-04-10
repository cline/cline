import * as vscode from "vscode"
import { arePathsEqual } from "../../utils/path"
import { Terminal } from "./Terminal"
import { TerminalProcess } from "./TerminalProcess"

// Although vscode.window.terminals provides a list of all open terminals, there's no way to know whether they're busy or not (exitStatus does not provide useful information for most commands). In order to prevent creating too many terminals, we need to keep track of terminals through the life of the extension, as well as session specific terminals for the life of a task (to get latest unretrieved output).
// Since we have promises keeping track of terminal processes, we get the added benefit of keep track of busy terminals even after a task is closed.
export class TerminalRegistry {
	private static terminals: Terminal[] = []
	private static nextTerminalId = 1
	private static disposables: vscode.Disposable[] = []
	private static isInitialized = false

	static initialize() {
		if (this.isInitialized) {
			throw new Error("TerminalRegistry.initialize() should only be called once")
		}
		this.isInitialized = true

		try {
			// onDidStartTerminalShellExecution
			const startDisposable = vscode.window.onDidStartTerminalShellExecution?.(
				async (e: vscode.TerminalShellExecutionStartEvent) => {
					// Get a handle to the stream as early as possible:
					const stream = e?.execution.read()
					const terminalInfo = this.getTerminalByVSCETerminal(e.terminal)

					console.info("[TerminalRegistry] Shell execution started:", {
						hasExecution: !!e?.execution,
						command: e?.execution?.commandLine?.value,
						terminalId: terminalInfo?.id,
					})

					if (terminalInfo) {
						terminalInfo.running = true
						terminalInfo.setActiveStream(stream)
					} else {
						console.error(
							"[TerminalRegistry] Shell execution started, but not from a Roo-registered terminal:",
							e,
						)
					}
				},
			)

			// onDidEndTerminalShellExecution
			const endDisposable = vscode.window.onDidEndTerminalShellExecution?.(
				async (e: vscode.TerminalShellExecutionEndEvent) => {
					const terminalInfo = this.getTerminalByVSCETerminal(e.terminal)
					const process = terminalInfo?.process

					const exitDetails = TerminalProcess.interpretExitCode(e?.exitCode)

					console.info("[TerminalRegistry] Shell execution ended:", {
						hasExecution: !!e?.execution,
						command: e?.execution?.commandLine?.value,
						terminalId: terminalInfo?.id,
						...exitDetails,
					})

					if (!terminalInfo) {
						console.error(
							"[TerminalRegistry] Shell execution ended, but not from a Roo-registered terminal:",
							e,
						)
						return
					}

					if (!terminalInfo.running) {
						console.error(
							"[TerminalRegistry] Shell execution end event received, but process is not running for terminal:",
							{
								terminalId: terminalInfo?.id,
								command: process?.command,
								exitCode: e?.exitCode,
							},
						)
						return
					}

					if (!process) {
						console.error(
							"[TerminalRegistry] Shell execution end event received on running terminal, but process is undefined:",
							{
								terminalId: terminalInfo.id,
								exitCode: e?.exitCode,
							},
						)
						return
					}

					// Signal completion to any waiting processes
					if (terminalInfo) {
						terminalInfo.running = false
						terminalInfo.shellExecutionComplete(exitDetails)
					}
				},
			)

			if (startDisposable) {
				this.disposables.push(startDisposable)
			}
			if (endDisposable) {
				this.disposables.push(endDisposable)
			}
		} catch (error) {
			console.error("[TerminalRegistry] Error setting up shell execution handlers:", error)
		}
	}

	static createTerminal(cwd: string | vscode.Uri): Terminal {
		const env: Record<string, string> = {
			PAGER: "cat",

			// VTE must be disabled because it prevents the prompt command from executing
			// See https://wiki.gnome.org/Apps/Terminal/VTE
			VTE_VERSION: "0",
		}

		// VSCode bug#237208: Command output can be lost due to a race between completion
		// sequences and consumers. Add delay via PROMPT_COMMAND to ensure the
		// \x1b]633;D escape sequence arrives after command output is processed.
		// Only add this if commandDelay is not zero
		if (Terminal.getCommandDelay() > 0) {
			env.PROMPT_COMMAND = `sleep ${Terminal.getCommandDelay() / 1000}`
		}

		const terminal = vscode.window.createTerminal({
			cwd,
			name: "Roo Code",
			iconPath: new vscode.ThemeIcon("rocket"),
			env,
		})

		const cwdString = cwd.toString()
		const newTerminal = new Terminal(this.nextTerminalId++, terminal, cwdString)

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

	/**
	 * Gets a terminal by its VSCode terminal instance
	 * @param terminal The VSCode terminal instance
	 * @returns The Terminal object, or undefined if not found
	 */
	static getTerminalByVSCETerminal(terminal: vscode.Terminal): Terminal | undefined {
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

	/**
	 * Gets unretrieved output from a terminal process
	 * @param terminalId The terminal ID
	 * @returns The unretrieved output as a string, or empty string if terminal not found
	 */
	static getUnretrievedOutput(terminalId: number): string {
		const terminal = this.getTerminal(terminalId)
		if (!terminal) {
			return ""
		}
		return terminal.getUnretrievedOutput()
	}

	/**
	 * Checks if a terminal process is "hot" (recently active)
	 * @param terminalId The terminal ID
	 * @returns True if the process is hot, false otherwise
	 */
	static isProcessHot(terminalId: number): boolean {
		const terminal = this.getTerminal(terminalId)
		if (!terminal) {
			return false
		}
		return terminal.process ? terminal.process.isHot : false
	}
	/**
	 * Gets terminals filtered by busy state and optionally by task ID
	 * @param busy Whether to get busy or non-busy terminals
	 * @param taskId Optional task ID to filter terminals by
	 * @returns Array of Terminal objects
	 */
	static getTerminals(busy: boolean, taskId?: string): Terminal[] {
		return this.getAllTerminals().filter((t) => {
			// Filter by busy state
			if (t.busy !== busy) {
				return false
			}

			// If taskId is provided, also filter by taskId
			if (taskId !== undefined && t.taskId !== taskId) {
				return false
			}

			return true
		})
	}

	/**
	 * Gets background terminals (taskId undefined) that have unretrieved output or are still running
	 * @param busy Whether to get busy or non-busy terminals
	 * @returns Array of Terminal objects
	 */
	/**
	 * Gets background terminals (taskId undefined) filtered by busy state
	 * @param busy Whether to get busy or non-busy terminals
	 * @returns Array of Terminal objects
	 */
	static getBackgroundTerminals(busy?: boolean): Terminal[] {
		return this.getAllTerminals().filter((t) => {
			// Only get background terminals (taskId undefined)
			if (t.taskId !== undefined) {
				return false
			}

			// If busy is undefined, return all background terminals
			if (busy === undefined) {
				return t.getProcessesWithOutput().length > 0 || t.process?.hasUnretrievedOutput()
			} else {
				// Filter by busy state
				return t.busy === busy
			}
		})
	}

	static cleanup() {
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}

	/**
	 * Releases all terminals associated with a task
	 * @param taskId The task ID
	 */
	static releaseTerminalsForTask(taskId?: string): void {
		if (!taskId) return

		this.terminals.forEach((terminal) => {
			if (terminal.taskId === taskId) {
				terminal.taskId = undefined
			}
		})
	}

	/**
	 * Gets an existing terminal or creates a new one for the given working directory
	 * @param cwd The working directory path
	 * @param requiredCwd Whether the working directory is required (if false, may reuse any non-busy terminal)
	 * @param taskId Optional task ID to associate with the terminal
	 * @returns A Terminal instance
	 */
	static async getOrCreateTerminal(cwd: string, requiredCwd: boolean = false, taskId?: string): Promise<Terminal> {
		const terminals = this.getAllTerminals()
		let terminal: Terminal | undefined

		// First priority: Find a terminal already assigned to this task with matching directory
		if (taskId) {
			terminal = terminals.find((t) => {
				if (t.busy || t.taskId !== taskId) {
					return false
				}
				const terminalCwd = t.getCurrentWorkingDirectory()
				if (!terminalCwd) {
					return false
				}
				return arePathsEqual(vscode.Uri.file(cwd).fsPath, terminalCwd)
			})
		}

		// Second priority: Find any available terminal with matching directory
		if (!terminal) {
			terminal = terminals.find((t) => {
				if (t.busy) {
					return false
				}
				const terminalCwd = t.getCurrentWorkingDirectory()
				if (!terminalCwd) {
					return false
				}
				return arePathsEqual(vscode.Uri.file(cwd).fsPath, terminalCwd)
			})
		}

		// Third priority: Find any non-busy terminal (only if directory is not required)
		if (!terminal && !requiredCwd) {
			terminal = terminals.find((t) => !t.busy)
		}

		// If no suitable terminal found, create a new one
		if (!terminal) {
			terminal = this.createTerminal(cwd)
		}

		terminal.taskId = taskId

		return terminal
	}
}
