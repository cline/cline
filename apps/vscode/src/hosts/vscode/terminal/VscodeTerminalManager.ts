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
	}

	private runTerminalProcess(process: VscodeTerminalProcess, terminal: vscode.Terminal, command: string): void {
		void process.run(terminal, command).catch((error) => {
			process.releaseActiveExecutionResources()
			process.emit("error", error instanceof Error ? error : new Error(String(error)))
		})
	}

	runCommand(terminalInfo: ITerminalInfo, command: string, cwd?: string): ITerminalProcessResultPromise {
		// Cast to VSCode-specific TerminalInfo for internal use
		// Using unknown as intermediate cast due to structural differences between ITerminal and vscode.Terminal
		const vscodeTerminalInfo = terminalInfo as unknown as TerminalInfo
		Logger.log(`[TerminalManager] Running command on terminal ${vscodeTerminalInfo.id}: "${command}"`)
		Logger.log(`[TerminalManager] Terminal ${vscodeTerminalInfo.id} busy state before: ${vscodeTerminalInfo.busy}`)

		vscodeTerminalInfo.busy = true
		vscodeTerminalInfo.lastCommand = command
		const process = new VscodeTerminalProcess()
		this.processes.set(vscodeTerminalInfo.id, process)

		process.once("completed", () => {
			Logger.log(`[TerminalManager] Terminal ${vscodeTerminalInfo.id} completed, setting busy to false`)
			vscodeTerminalInfo.busy = false
			if (vscodeTerminalInfo.terminal.exitStatus !== undefined) {
				this.evictTerminal(vscodeTerminalInfo)
			}
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

		const startCommand = async (): Promise<void> => {
			// Accessing processId starts the pty without revealing the terminal.
			await vscodeTerminalInfo.terminal.processId

			const terminalCwd = vscodeTerminalInfo.terminal.shellIntegration?.cwd?.fsPath ?? vscodeTerminalInfo.trackedCwd
			const terminalCommand =
				cwd && !arePathsEqual(vscode.Uri.file(cwd).fsPath, terminalCwd) ? `cd "${cwd}" && ${command}` : command
			if (cwd) {
				vscodeTerminalInfo.trackedCwd = cwd
			}
			vscodeTerminalInfo.lastCommand = terminalCommand

			// if shell integration is already active, run the command immediately
			if (vscodeTerminalInfo.terminal.shellIntegration) {
				process.waitForShellIntegration = false
				this.runTerminalProcess(process, vscodeTerminalInfo.terminal, terminalCommand)
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
						Logger.log(
							`[TerminalManager Test] Proceeding with command execution for terminal ${vscodeTerminalInfo.id}.`,
						)
						const existingProcess = this.processes.get(vscodeTerminalInfo.id)
						if (existingProcess && existingProcess.waitForShellIntegration) {
							existingProcess.waitForShellIntegration = false
							this.runTerminalProcess(existingProcess, vscodeTerminalInfo.terminal, terminalCommand)
						}
					})
			}
		}
		void startCommand().catch((error) => {
			process.releaseActiveExecutionResources()
			process.emit("error", error instanceof Error ? error : new Error(String(error)))
		})

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
	 * Interrupt the command currently running in a terminal.
	 *
	 * VS Code exposes no API to kill a terminal's foreground process, so this
	 * writes the ETX control character (`\x03`, i.e. Ctrl+C) without a trailing
	 * newline; the pty's line discipline delivers it to the foreground process
	 * group as SIGINT. Used when a task is cancelled so the spawned command
	 * actually stops instead of continuing to run after Cline stops observing it.
	 * The terminal itself is left open for reuse.
	 */
	sendInterrupt(terminalInfo: ITerminalInfo): void {
		const vscodeTerminalInfo = terminalInfo as unknown as TerminalInfo
		vscodeTerminalInfo.terminal.sendText("\x03", false)
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
			const terminalCwd = t.terminal.shellIntegration?.cwd?.fsPath ?? t.trackedCwd
			const matches = arePathsEqual(vscode.Uri.file(cwd).fsPath, terminalCwd)
			Logger.log(`[TerminalManager] Terminal ${t.id} cwd: ${terminalCwd}, matches: ${matches}`)
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
				this.terminalIds.add(availableTerminal.id)
				return availableTerminal as unknown as ITerminalInfo
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

	/** Dispose idle terminals; clear manager state only during full teardown. */
	disposeAll(disposeManager = true): void {
		TerminalRegistry.disposeIdleTerminals()
		if (!disposeManager) {
			return
		}
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
		const process = this.processes.get(terminalInfo.id)
		const completionDetails = process?.getCompletionDetails?.()
		const hasUnobservedCommand = completionDetails?.unobservedCommand !== undefined
		this.terminalIds.delete(terminalInfo.id)
		this.processes.delete(terminalInfo.id)
		if (!terminalInfo.busy && !hasUnobservedCommand) {
			TerminalRegistry.queueTerminalForCleanup(terminalInfo)
		} else {
			TerminalRegistry.removeTerminal(terminalInfo.id)
		}
	}
}
