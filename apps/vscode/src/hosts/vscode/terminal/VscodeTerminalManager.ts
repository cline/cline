import { arePathsEqual } from "@utils/path"
import { getShell, getShellForProfile } from "@utils/shell"
import pWaitFor from "p-wait-for"
import * as vscode from "vscode"
import {
	TerminalInfo as ITerminalInfo,
	TerminalProcessResultPromise as ITerminalProcessResultPromise,
} from "@/integrations/terminal/types"
import { isRefactoringEnabled } from "@/shared/services/feature-flags/refactoring-flags"
import { Logger } from "@/shared/services/Logger"
import { mergePromise, VscodeTerminalProcess } from "./VscodeTerminalProcess"
import { TerminalInfo, TerminalRegistry } from "./VscodeTerminalRegistry"

const CWD_COMMAND_TIMEOUT_MS = 5000
const CWD_STATE_TIMEOUT_MS = 1000

/**
 * Maximum time (ms) a terminal can stay busy before its flag is auto-released.
 * Prevents terminal-starvation deadlock when a terminal's completion promise
 * is never settled (e.g. user closes the terminal, task interrupted mid-write).
 * Guarded by the `terminalBusyTimeout` feature flag.
 */
const BUSY_TIMEOUT_MS = 300_000 // 5 minutes

/**
 * Maximum number of tracked terminals before the least-recently-used is
 * evicted. Prevent unbounded terminal-ID accumulation when many tasks are
 * created without cleanup.
 * Guarded by the `terminalBusyTimeout` feature flag (same flag — both deal
 * with terminal lifecycle hygiene).
 */
const MAX_TERMINALS = 50

/*
TerminalManager:
- Creates/reuses terminals
- Runs commands via runCommand(), returning a TerminalProcess
- Handles shell integration events

TerminalProcess extends EventEmitter and implements Promise:
- Emits 'line' events with output while promise is pending
- process.continue() resolves promise and stops event emission
- Allows real-time output handling or background execution

getUnretrievedOutput() fetches latest output for ongoing commands

Enables flexible command execution:
- Await for completion
- Listen to real-time events
- Continue execution in background
- Retrieve missed output later

Notes:
- it turns out some shellIntegration APIs are available on cursor, although not on older versions of vscode
- "By default, the shell integration script should automatically activate on supported shells launched from VS Code."
Supported shells:
Linux/macOS: bash, fish, pwsh, zsh
Windows: pwsh


Example:

const terminalManager = new TerminalManager(context);

// Run a command
const process = terminalManager.runCommand('npm install', '/path/to/project');

process.on('line', (line) => {
	Logger.log(line);
});

// To wait for the process to complete naturally:
await process;

// Or to continue execution even if the command is still running:
process.continue();

// Later, if you need to get the unretrieved output:
const unretrievedOutput = terminalManager.getUnretrievedOutput(terminalId);
Logger.log('Unretrieved output:', unretrievedOutput);

Resources:
- https://github.com/microsoft/vscode/issues/226655
- https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api
- https://code.visualstudio.com/docs/terminal/shell-integration
- https://code.visualstudio.com/api/references/vscode-api#Terminal
- https://github.com/microsoft/vscode-extension-samples/blob/main/terminal-sample/src/extension.ts
- https://github.com/microsoft/vscode-extension-samples/blob/main/shell-integration-sample/src/extension.ts
*/

export class VscodeTerminalManager {
	private terminalIds: Set<number> = new Set()
	private processes: Map<number, VscodeTerminalProcess> = new Map()
	private disposables: vscode.Disposable[] = []
	private shellIntegrationTimeout = 4000
	private terminalReuseEnabled = true
	private defaultTerminalProfile = "default"

	/**
	 * Resolve a terminal's stored shellPath to an effective path.
	 * Terminals created with the "default" profile have shellPath=undefined;
	 * this resolves that to the actual default shell (e.g. /bin/zsh on macOS)
	 * so we can compare apples-to-apples when deciding whether a terminal
	 * is compatible with the current profile setting.
	 */
	private static effectiveShellPath(shellPath: string | undefined): string {
		return shellPath ?? getShell()
	}

	constructor() {
		// onDidStartTerminalShellExecution has been stable API since VS Code 1.93,
		// below our minimum supported version (see package.json engines.vscode).
		const startDisposable = vscode.window.onDidStartTerminalShellExecution((e) => {
			// Creating a read stream here results in a more consistent output. This is most obvious when running the `date` command.
			e.execution.read()
		})
		this.disposables.push(startDisposable)

		// Add a listener for terminal state changes to detect CWD updates
		try {
			const stateChangeDisposable = vscode.window.onDidChangeTerminalState((terminal) => {
				const terminalInfo = this.findTerminalInfoByTerminal(terminal)
				if (terminalInfo && terminalInfo.pendingCwdChange && terminalInfo.cwdResolved) {
					// Check if CWD has been updated to match the expected path
					if (this.isCwdMatchingExpected(terminalInfo)) {
						const resolver = terminalInfo.cwdResolved.resolve
						terminalInfo.pendingCwdChange = undefined
						terminalInfo.cwdResolved = undefined
						resolver()
					}
				}
			})
			this.disposables.push(stateChangeDisposable)
		} catch (error) {
			Logger.error("Error setting up onDidChangeTerminalState", error)
		}
	}

	//Find a TerminalInfo by its VSCode Terminal instance
	private findTerminalInfoByTerminal(terminal: vscode.Terminal): TerminalInfo | undefined {
		const terminals = TerminalRegistry.getAllTerminals()
		return terminals.find((t) => t.terminal === terminal)
	}

	//Check if a terminal's CWD matches its expected pending change
	private isCwdMatchingExpected(terminalInfo: TerminalInfo): boolean {
		if (!terminalInfo.pendingCwdChange) {
			return false
		}

		const currentCwd = terminalInfo.terminal.shellIntegration?.cwd?.fsPath
		const targetCwd = vscode.Uri.file(terminalInfo.pendingCwdChange).fsPath

		if (!currentCwd) {
			return false
		}

		return arePathsEqual(currentCwd, targetCwd)
	}

	private async drainCommandOutput(output: AsyncIterable<string>): Promise<void> {
		for await (const _chunk of output) {
			// Drain the stream so shell integration can report command completion.
		}
	}

	// VS Code shell integration sometimes finishes the internal `cd` command without
	// reporting completion through the execution stream. Timeout this setup step so
	// the user's actual command is still sent instead of leaving the chat stuck.
	private async runCwdChangeCommand(terminalInfo: TerminalInfo, cwd: string): Promise<boolean> {
		const command = `cd "${cwd}"`
		const shellIntegration = terminalInfo.terminal.shellIntegration

		if (!shellIntegration?.executeCommand) {
			terminalInfo.terminal.sendText(command, true)
			Logger.warn(
				`[TerminalManager] Shell integration executeCommand is unavailable while changing terminal ${terminalInfo.id} cwd. Proceeding after ${CWD_COMMAND_TIMEOUT_MS}ms.`,
			)
			await new Promise((resolve) => setTimeout(resolve, CWD_COMMAND_TIMEOUT_MS))
			return true
		}

		let timeout: NodeJS.Timeout | undefined
		let didTimeOut = false

		try {
			const execution = shellIntegration.executeCommand(command)
			await Promise.race([
				this.drainCommandOutput(execution.read()),
				new Promise<void>((resolve) => {
					timeout = setTimeout(() => {
						didTimeOut = true
						Logger.warn(
							`[TerminalManager] Timed out waiting ${CWD_COMMAND_TIMEOUT_MS}ms for terminal ${terminalInfo.id} to run cd "${cwd}". Proceeding with requested command.`,
						)
						resolve()
					}, CWD_COMMAND_TIMEOUT_MS)
				}),
			])
		} catch (error) {
			Logger.warn(`[TerminalManager] Failed to observe terminal ${terminalInfo.id} cwd command completion`, error)
			return true
		} finally {
			if (timeout) {
				clearTimeout(timeout)
			}
		}

		return didTimeOut
	}

	runCommand(terminalInfo: ITerminalInfo, command: string): ITerminalProcessResultPromise {
		// Cast to VSCode-specific TerminalInfo for internal use
		// Using unknown as intermediate cast due to structural differences between ITerminal and vscode.Terminal
		const vscodeTerminalInfo = terminalInfo as unknown as TerminalInfo
		Logger.log(`[TerminalManager] Running command on terminal ${vscodeTerminalInfo.id}: "${command}"`)
		Logger.log(`[TerminalManager] Terminal ${vscodeTerminalInfo.id} busy state before: ${vscodeTerminalInfo.busy}`)

		vscodeTerminalInfo.busy = true
		vscodeTerminalInfo.lastCommand = command
		const process = new VscodeTerminalProcess()
		this.processes.set(vscodeTerminalInfo.id, process)

		// Busy timeout guard: if the process never completes (e.g. terminal
		// closed externally, task interrupted mid-execution), auto-release the
		// busy flag after BUSY_TIMEOUT_MS so the terminal can be reused.
		// Guarded by the `terminalBusyTimeout` feature flag.
		let busyTimeout: ReturnType<typeof setTimeout> | undefined
		if (isRefactoringEnabled("terminalBusyTimeout")) {
			busyTimeout = setTimeout(() => {
				if (vscodeTerminalInfo.busy) {
					Logger.warn(
						`[TerminalManager] Busy timeout elapsed (${BUSY_TIMEOUT_MS}ms) for terminal ${vscodeTerminalInfo.id}, auto-releasing busy flag`,
					)
					vscodeTerminalInfo.busy = false
				}
			}, BUSY_TIMEOUT_MS)
		}

		process.once("completed", () => {
			Logger.log(`[TerminalManager] Terminal ${vscodeTerminalInfo.id} completed, setting busy to false`)
			vscodeTerminalInfo.busy = false
			if (busyTimeout) clearTimeout(busyTimeout)
		})

		// if shell integration is not available, remove terminal so it does not get reused as it may be running a long-running process
		process.once("no_shell_integration", () => {
			Logger.log(`no_shell_integration received for terminal ${vscodeTerminalInfo.id}`)
			// Remove the terminal so we can't reuse it (in case it's running a long-running process)
			TerminalRegistry.removeTerminal(vscodeTerminalInfo.id)
			this.terminalIds.delete(vscodeTerminalInfo.id)
			this.processes.delete(vscodeTerminalInfo.id)
		})

		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => {
				resolve()
			})
			process.once("error", (error) => {
				Logger.error(`Error in terminal ${vscodeTerminalInfo.id}:`, error)
				reject(error)
			})
		})

		// if shell integration is already active, run the command immediately
		if (vscodeTerminalInfo.terminal.shellIntegration) {
			process.waitForShellIntegration = false
			process.run(vscodeTerminalInfo.terminal, command)
		} else {
			// docs recommend waiting 3s for shell integration to activate
			Logger.log(
				`[TerminalManager Test] Waiting for shell integration for terminal ${vscodeTerminalInfo.id} with timeout ${this.shellIntegrationTimeout}ms`,
			)
			pWaitFor(() => vscodeTerminalInfo.terminal.shellIntegration !== undefined, {
				timeout: this.shellIntegrationTimeout,
			})
				.then(() => {
					Logger.log(
						`[TerminalManager Test] Shell integration activated for terminal ${vscodeTerminalInfo.id} within timeout.`,
					)
				})
				.catch((err) => {
					Logger.warn(
						`[TerminalManager Test] Shell integration timed out or failed for terminal ${vscodeTerminalInfo.id}: ${err.message}`,
					)
				})
				.finally(() => {
					Logger.log(`[TerminalManager Test] Proceeding with command execution for terminal ${vscodeTerminalInfo.id}.`)
					const existingProcess = this.processes.get(vscodeTerminalInfo.id)
					if (existingProcess && existingProcess.waitForShellIntegration) {
						existingProcess.waitForShellIntegration = false
						existingProcess.run(vscodeTerminalInfo.terminal, command)
					}
				})
		}

		return mergePromise(process, promise)
	}

	/**
	 * @param profileId Terminal profile to create/match the terminal with.
	 * Defaults to the current setting; callers that captured the profile
	 * earlier (e.g. when the model request was built) pass it here so a
	 * settings change does not switch shells under an in-flight tool call.
	 */
	async getOrCreateTerminal(cwd: string, profileId: string = this.defaultTerminalProfile): Promise<ITerminalInfo> {
		const terminals = TerminalRegistry.getAllTerminals()
		const expectedShellPath = profileId !== "default" ? getShellForProfile(profileId) : undefined
		// Resolve effective shell for comparison (so "default" and "zsh" match on macOS)
		const effectiveExpected = VscodeTerminalManager.effectiveShellPath(expectedShellPath)

		// Find available terminal from our pool first (created for this task)
		Logger.log(`[TerminalManager] Looking for terminal in cwd: ${cwd}`)
		Logger.log(`[TerminalManager] Available terminals: ${terminals.length}`)

		const matchingTerminal = terminals.find((t) => {
			if (t.busy) {
				Logger.log(`[TerminalManager] Terminal ${t.id} is busy, skipping`)
				return false
			}
			// Check if effective shell path matches current configuration
			if (VscodeTerminalManager.effectiveShellPath(t.shellPath) !== effectiveExpected) {
				return false
			}
			const terminalCwd = t.terminal.shellIntegration?.cwd // one of cline's commands could have changed the cwd of the terminal
			if (!terminalCwd) {
				Logger.log(`[TerminalManager] Terminal ${t.id} has no cwd, skipping`)
				return false
			}
			const matches = arePathsEqual(vscode.Uri.file(cwd).fsPath, terminalCwd.fsPath)
			Logger.log(`[TerminalManager] Terminal ${t.id} cwd: ${terminalCwd.fsPath}, matches: ${matches}`)
			return matches
		})
		if (matchingTerminal) {
			Logger.log(`[TerminalManager] Found matching terminal ${matchingTerminal.id} in correct cwd`)
			this.terminalIds.add(matchingTerminal.id)
			// Cast to ITerminalInfo for interface compatibility
			return matchingTerminal as unknown as ITerminalInfo
		}

		// If no non-busy terminal in the current working dir exists and terminal reuse is enabled, try to find any non-busy terminal regardless of CWD
		if (this.terminalReuseEnabled) {
			const availableTerminal = terminals.find(
				(t) => !t.busy && VscodeTerminalManager.effectiveShellPath(t.shellPath) === effectiveExpected,
			)
			if (availableTerminal) {
				availableTerminal.busy = true

				// Set up promise and tracking for CWD change
				const cwdPromise = new Promise<void>((resolve, reject) => {
					availableTerminal.pendingCwdChange = cwd
					availableTerminal.cwdResolved = { resolve, reject }
				})
				// Showing the reused terminal gives VS Code a chance to initialize shell integration.
				// runCommand() below waits up to shellIntegrationTimeout for executeCommand before falling back.
				availableTerminal.terminal.show()

				try {
					const didCwdCommandTimeOut = await this.runCwdChangeCommand(availableTerminal, cwd)

					// Add a small delay to ensure terminal is ready after cd
					if (!didCwdCommandTimeOut) {
						await new Promise((resolve) => setTimeout(resolve, 100))
					}

					// Either resolve immediately if CWD already updated or wait for event/timeout
					if (this.isCwdMatchingExpected(availableTerminal)) {
						if (availableTerminal.cwdResolved) {
							availableTerminal.cwdResolved.resolve()
						}
					} else if (!didCwdCommandTimeOut) {
						await Promise.race([cwdPromise, new Promise((resolve) => setTimeout(resolve, CWD_STATE_TIMEOUT_MS))])
					}
				} finally {
					availableTerminal.pendingCwdChange = undefined
					availableTerminal.cwdResolved = undefined
					availableTerminal.busy = false
				}
				this.terminalIds.add(availableTerminal.id)
				// Cast to ITerminalInfo for interface compatibility
				return availableTerminal as unknown as ITerminalInfo
			}
		}

		// If all terminals are busy or don't match shell profile, create a new one with the configured shell
		if (isRefactoringEnabled("terminalBusyTimeout")) {
			// Enforce max terminals: evict LRA (least-recently-active) terminals
			// when pool exceeds MAX_TERMINALS. Prevents unbounded accumulation
			// on long-running VSCode instances with many task sessions.
			const allTerminals = TerminalRegistry.getAllTerminals()
			if (allTerminals.length >= MAX_TERMINALS) {
				const sorted = [...allTerminals].sort((a, b) => a.lastActive - b.lastActive)
				const evicted = sorted.slice(0, allTerminals.length - MAX_TERMINALS + 1)
				for (const t of evicted) {
					Logger.warn(`[TerminalManager] Evicting LRA terminal ${t.id} (max ${MAX_TERMINALS} reached)`)
					TerminalRegistry.removeTerminal(t.id)
					this.terminalIds.delete(t.id)
					this.processes.delete(t.id)
				}
			}
		}

		const newTerminalInfo = TerminalRegistry.createTerminal(cwd, expectedShellPath)
		this.terminalIds.add(newTerminalInfo.id)
		// Cast to ITerminalInfo for interface compatibility
		return newTerminalInfo as unknown as ITerminalInfo
	}

	getTerminals(busy: boolean): { id: number; lastCommand: string }[] {
		return Array.from(this.terminalIds)
			.map((id) => TerminalRegistry.getTerminal(id))
			.filter((t): t is TerminalInfo => t !== undefined && t.busy === busy)
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }))
	}

	getUnretrievedOutput(terminalId: number): string {
		if (!this.terminalIds.has(terminalId)) {
			return ""
		}
		const process = this.processes.get(terminalId)
		return process ? process.getUnretrievedOutput() : ""
	}

	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	disposeAll() {
		// for (const info of this.terminals) {
		// 	//info.terminal.dispose() // dont want to dispose terminals when task is aborted
		// }
		this.terminalIds.clear()
		this.processes.clear()
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}

	/**
	 * Dispose the terminal manager. Idempotent alias for `disposeAll()`.
	 * Also disposes the shell-execution listener and other registered VS Code
	 * disposables.
	 */
	dispose(): void {
		this.disposeAll()
	}

	setShellIntegrationTimeout(timeout: number): void {
		this.shellIntegrationTimeout = timeout
	}

	setTerminalReuseEnabled(enabled: boolean): void {
		this.terminalReuseEnabled = enabled
	}

	setDefaultTerminalProfile(profileId: string): void {
		// Just update the profile setting. We don't close existing terminals —
		// they stay open and are reusable if the user switches back. New
		// terminals created by getOrCreateTerminal() will use the new profile,
		// and existing terminals with a different effective shell are simply
		// skipped during reuse matching.
		this.defaultTerminalProfile = profileId
	}
}
