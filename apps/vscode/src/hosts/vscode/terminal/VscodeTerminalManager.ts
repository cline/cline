import { arePathsEqual } from "@utils/path"
import { getShell, getShellForProfile } from "@utils/shell"
import pWaitFor from "p-wait-for"
import * as vscode from "vscode"
import {
	getUnobservedTerminalCommandDisposition,
	type TerminalInfo as ITerminalInfo,
	type TerminalProcessResultPromise as ITerminalProcessResultPromise,
} from "@/integrations/terminal/types"
import { Logger } from "@/shared/services/Logger"
import { mergePromise, VscodeTerminalProcess } from "./VscodeTerminalProcess"
import { TerminalInfo, TerminalRegistry } from "./VscodeTerminalRegistry"

const CWD_COMMAND_TIMEOUT_MS = 5000
const CWD_STATE_TIMEOUT_MS = 1000

type CwdChangeResult = "observed" | "unobserved"

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
						// Keep the target until the acquisition's finally block so the
						// caller can confirm the resolved state before handing off.
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
	private async runCwdChangeCommand(terminalInfo: TerminalInfo, cwd: string): Promise<CwdChangeResult> {
		const command = `cd "${cwd}"`
		const shellIntegration = terminalInfo.terminal.shellIntegration

		if (!shellIntegration?.executeCommand) {
			terminalInfo.terminal.sendText(command, true)
			Logger.warn(
				`[TerminalManager] Shell integration executeCommand is unavailable while changing terminal ${terminalInfo.id} cwd. Proceeding after ${CWD_COMMAND_TIMEOUT_MS}ms.`,
			)
			await new Promise((resolve) => setTimeout(resolve, CWD_COMMAND_TIMEOUT_MS))
			return "unobserved"
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
			throw error
		} finally {
			if (timeout) {
				clearTimeout(timeout)
			}
		}

		return didTimeOut ? "unobserved" : "observed"
	}

	private runTerminalProcess(process: VscodeTerminalProcess, terminal: vscode.Terminal, command: string): void {
		void process.run(terminal, command).catch((error) => {
			process.releaseActiveExecutionResources()
			process.emit("error", error instanceof Error ? error : new Error(String(error)))
		})
	}

	runCommand(terminalInfo: ITerminalInfo, command: string): ITerminalProcessResultPromise {
		// Cast to VSCode-specific TerminalInfo for internal use
		// Using unknown as intermediate cast due to structural differences between ITerminal and vscode.Terminal
		const vscodeTerminalInfo = terminalInfo as unknown as TerminalInfo
		Logger.log(`[TerminalManager] Running command on terminal ${vscodeTerminalInfo.id}: "${command}"`)
		Logger.log(`[TerminalManager] Terminal ${vscodeTerminalInfo.id} busy state before: ${vscodeTerminalInfo.busy}`)

		try {
			vscodeTerminalInfo.terminal.show()
		} catch (error) {
			vscodeTerminalInfo.busy = false
			throw error
		}
		vscodeTerminalInfo.busy = true
		vscodeTerminalInfo.lastCommand = command
		const process = new VscodeTerminalProcess()
		this.processes.set(vscodeTerminalInfo.id, process)

		process.once("completed", () => {
			Logger.log(`[TerminalManager] Terminal ${vscodeTerminalInfo.id} completed, setting busy to false`)
			vscodeTerminalInfo.busy = false
		})
		process.once("error", () => {
			// A stream/API failure does not prove the launched command stopped.
			// Evict the terminal from Cline reuse without disposing potentially
			// active user work.
			this.evictTerminal(vscodeTerminalInfo)
		})

		process.once("unobserved_command", (outcome) => {
			Logger.log(`unobserved_command (${outcome.source}) received for terminal ${vscodeTerminalInfo.id}`)
			this.evictTerminal(vscodeTerminalInfo)
			// Markerless streams (for example, an SSH session) and commands Cline no
			// longer owns remain open. Ordinary managed sendText fallbacks are
			// reclaimed at the next acquisition, after this tool result can report
			// that their completion is indeterminate.
			if (getUnobservedTerminalCommandDisposition(outcome) === "disposeBeforeNextTerminalAcquisition") {
				TerminalRegistry.queueTerminalForCleanup(vscodeTerminalInfo)
			}
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
			this.runTerminalProcess(process, vscodeTerminalInfo.terminal, command)
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
						this.runTerminalProcess(existingProcess, vscodeTerminalInfo.terminal, command)
					}
				})
		}

		return mergePromise(process, promise)
	}

	/**
	 * A pre-start cancellation takes effect immediately for the tool result. The
	 * in-flight acquisition still owns its exact reservation until it settles;
	 * release that reservation here without starting or disposing the terminal.
	 */
	releaseTerminalReservation(terminalInfo: ITerminalInfo): void {
		const vscodeTerminalInfo = terminalInfo as unknown as TerminalInfo
		vscodeTerminalInfo.busy = false
	}

	/**
	 * @param profileId Terminal profile to create/match the terminal with.
	 * Defaults to the current setting; callers that captured the profile
	 * earlier (e.g. when the model request was built) pass it here so a
	 * settings change does not switch shells under an in-flight tool call.
	 * The returned terminal is reserved until runCommand() takes ownership.
	 */
	async getOrCreateTerminal(cwd: string, profileId: string = this.defaultTerminalProfile): Promise<ITerminalInfo> {
		// A fallback terminal becomes cleanup-eligible when its unobserved-command
		// outcome is emitted. Dispose the snapshot of eligible terminals before
		// selecting a terminal for this acquisition.
		TerminalRegistry.disposeTerminalsPendingCleanup()
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
			// Reserve synchronously before returning so parallel acquisitions cannot
			// select this terminal before runCommand() marks it busy.
			matchingTerminal.busy = true
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
				let didHandOffReservation = false
				try {
					// Set up promise and tracking for CWD change after reserving the
					// terminal so parallel acquisitions cannot select it.
					const cwdPromise = new Promise<void>((resolve, reject) => {
						availableTerminal.pendingCwdChange = cwd
						availableTerminal.cwdResolved = { resolve, reject }
					})
					// Showing the reused terminal gives VS Code a chance to initialize shell integration.
					// runCommand() below waits up to shellIntegrationTimeout for executeCommand before falling back.
					availableTerminal.terminal.show()

					let cwdChangeResult: CwdChangeResult | undefined
					try {
						cwdChangeResult = await this.runCwdChangeCommand(availableTerminal, cwd)
					} catch (error) {
						// The user's command has not started. The failed setup command may
						// still change this terminal later, so evict it and continue with a
						// fresh terminal rooted at the requested cwd.
						Logger.warn(
							`[TerminalManager] Failed to prepare terminal ${availableTerminal.id} for "${cwd}"; creating a new terminal`,
							error,
						)
						this.evictTerminal(availableTerminal)
					}

					// Add a small delay to ensure terminal is ready after cd
					if (cwdChangeResult === "observed") {
						await new Promise((resolve) => setTimeout(resolve, 100))
					}

					// Either resolve immediately if CWD already updated or wait for event/timeout
					const isCwdConfirmed = this.isCwdMatchingExpected(availableTerminal)
					if (isCwdConfirmed) {
						if (availableTerminal.cwdResolved) {
							availableTerminal.cwdResolved.resolve()
						}
					} else if (cwdChangeResult === "observed") {
						await Promise.race([cwdPromise, new Promise((resolve) => setTimeout(resolve, CWD_STATE_TIMEOUT_MS))])
					}

					if (cwdChangeResult !== undefined && availableTerminal.terminal.exitStatus !== undefined) {
						TerminalRegistry.removeTerminal(availableTerminal.id)
						throw new Error("The terminal's shell process exited while preparing to run the command.")
					}

					if (cwdChangeResult !== undefined && this.isCwdMatchingExpected(availableTerminal)) {
						this.terminalIds.add(availableTerminal.id)
						didHandOffReservation = true
						return availableTerminal as unknown as ITerminalInfo
					}

					// Never run a command in a terminal whose working directory could
					// not be confirmed. The setup command may still take effect later,
					// so evict this terminal and create a fresh one at the requested cwd.
					Logger.warn(
						`[TerminalManager] Could not confirm terminal ${availableTerminal.id} changed to "${cwd}"; creating a new terminal`,
					)
					this.evictTerminal(availableTerminal)
				} finally {
					availableTerminal.pendingCwdChange = undefined
					availableTerminal.cwdResolved = undefined
					if (!didHandOffReservation) {
						availableTerminal.busy = false
					}
				}
			}
		}

		// If all terminals are busy or don't match shell profile, create a new one with the configured shell
		const newTerminalInfo = TerminalRegistry.createTerminal(cwd, expectedShellPath)
		newTerminalInfo.busy = true
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

	private evictTerminal(terminalInfo: TerminalInfo): void {
		this.terminalIds.delete(terminalInfo.id)
		this.processes.delete(terminalInfo.id)
		TerminalRegistry.removeTerminal(terminalInfo.id)
	}
}
