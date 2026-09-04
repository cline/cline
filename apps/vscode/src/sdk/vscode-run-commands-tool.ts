/**
 * Custom `run_commands` tool that replaces the SDK's built-in version.
 *
 * This is an IDE-level feature built on top of the SDK, NOT part of the SDK.
 * It supports two execution modes, switchable dynamically per invocation:
 *
 *   - **Foreground (vscodeTerminal):** Uses VscodeTerminalManager for visible
 *     VS Code terminals with shell integration.
 *
 *   - **Background (backgroundExec):** Delegates to the SDK's createShellExecutor()
 *     for headless child_process.spawn execution.
 */

import { randomUUID } from "node:crypto"
import {
	CommandExitError,
	createShellExecutor,
	createShellTool,
	MAX_COMMAND_OUTPUT_CHARS,
	type RunCommandDetachKind,
	type ShellExecutionLimits,
	type ShellExecutor,
	type StructuredCommandInput,
	truncateCommandOutput,
} from "@cline/core"
import type { AgentTool, AgentToolContext } from "@cline/shared"
import { TerminalUserInterventionAction, telemetryService } from "@services/telemetry"
import { ClineTempManager } from "@services/temp"
import * as fs from "fs"
import { StateManager } from "@/core/storage/StateManager"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { MAX_UNRETRIEVED_LINES } from "@/integrations/terminal/constants"
import {
	getUnobservedTerminalCommandDisposition,
	type ITerminalProcess,
	type TerminalCompletionDetails,
} from "@/integrations/terminal/types"
import { Logger } from "@/shared/services/Logger"
import { getShellForProfile } from "@/utils/shell"
import type { VscodeRunCommandExecutionController } from "./vscode-run-command-execution-controller"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShellCommand = string | StructuredCommandInput
type VscodeTerminalExecutionMode = "vscodeTerminal" | "backgroundExec"

export const VSCODE_RUN_COMMAND_EXECUTION_PROFILES = {
	vscodeTerminal: {
		detachAfterMs: 30_000,
		killAfterMs: Number.POSITIVE_INFINITY,
	},
	backgroundExec: {
		detachAfterMs: 30_000,
		killAfterMs: 3_600_000,
	},
} as const satisfies Record<VscodeTerminalExecutionMode, ShellExecutionLimits>

/** The wrapper must outlive soft detach and the background hard deadline. */
export const VSCODE_RUN_COMMANDS_WRAPPER_TIMEOUT_MS = 3_660_000

/** Compatibility name retained for downstream imports. */
export const VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS = VSCODE_RUN_COMMANDS_WRAPPER_TIMEOUT_MS
export const FOREGROUND_COMMAND_AUTO_PROCEED_MS = VSCODE_RUN_COMMAND_EXECUTION_PROFILES.vscodeTerminal.detachAfterMs

/**
 * Cap on the "Proceed While Running" log file. A detached devserver can log
 * for days; once the cap is hit we stop appending and note the truncation.
 * ClineTempManager's periodic cleanup (age + total-size caps) is the backstop
 * for the files themselves.
 */
export const PROCEED_LOG_MAX_BYTES = 10 * 1024 * 1024
const PROCEED_LOG_FINAL_MESSAGE_MAX_CHARS = 4096

/** Options for creating the VSCode run_commands tool. */
export interface VscodeRunCommandsToolOptions {
	/** Workspace root directory. */
	cwd: string
	/** Lazy factory for the VscodeTerminalManager. Called once on first foreground use. */
	getTerminalManager: () => VscodeTerminalManager
	/** Timeout passed to the SDK shell tool wrapper and timeout telemetry. */
	bashTimeoutMs?: number
	/** Terminal execution mode captured when this session's tool set is built. */
	vscodeTerminalExecutionMode?: VscodeTerminalExecutionMode
	/** Shared foreground/background execution registry owned by SdkController. */
	commandExecutions?: VscodeRunCommandExecutionController
}

// ---------------------------------------------------------------------------
// Foreground execution — VscodeTerminalManager
// ---------------------------------------------------------------------------

function quoteShellArg(arg: string): string {
	if (arg.length === 0) {
		return "''"
	}
	if (!/[\s"'\\$`!&|;<>(){}[\]*?~]/.test(arg)) {
		return arg
	}
	return `'${arg.replace(/'/g, `'\\''`)}'`
}

export function formatCommandForTerminal(command: ShellCommand): string {
	if (typeof command === "string") {
		return command
	}
	if (!("args" in command)) {
		return command.command
	}
	return [command.command, ...(command.args ?? [])].map(quoteShellArg).join(" ")
}

/**
 * Stream the rest of a detached command's output to a log file: write the
 * lines buffered so far, then append each further 'line' event until
 * 'completed'. The write volume is capped at PROCEED_LOG_MAX_BYTES; the
 * stream is closed when the command completes or its process/acquisition
 * fails. Completion covers command end, Ctrl+C, terminal close, and the
 * markerless fallback.
 */
interface DetachedCommandLog {
	path: string
	attach(process: ITerminalProcess): void
	fail(error: unknown): void
}

type ForegroundCompletionOutcome = { kind: "exited"; exitCode: number } | { kind: "failed"; error: string }

function createDetachedCommandLog(
	terminalCommand: string,
	existingLines: readonly string[],
	onSettled?: (outcome: ForegroundCompletionOutcome) => void,
): DetachedCommandLog {
	const logFilePath = ClineTempManager.createTempFilePath("proceed-while-running")
	const stream = fs.createWriteStream(logFilePath, { flags: "a" })
	const sizeCapMessage = `[Log size cap of ${PROCEED_LOG_MAX_BYTES} bytes reached; further output is not logged.]`
	stream.on("error", (error) => {
		Logger.error(`[VscodeRunCommands] Failed writing proceed-while-running log ${logFilePath}:`, error)
	})

	let bytesWritten = 0
	const tryWriteLine = (line: string): boolean => {
		const chunk = `${line}\n`
		const chunkBytes = Buffer.byteLength(chunk)
		if (bytesWritten + chunkBytes > PROCEED_LOG_MAX_BYTES) {
			return false
		}
		bytesWritten += chunkBytes
		stream.write(chunk)
		return true
	}

	let sizeCapReached = !tryWriteLine(`[Running command: ${terminalCommand}]`)
	for (const line of existingLines) {
		if (!tryWriteLine(line)) {
			sizeCapReached = true
			break
		}
	}

	let settled = false
	let removeAttachedListeners = (): void => {}
	const end = (message: string, outcome: ForegroundCompletionOutcome): void => {
		if (settled) {
			return
		}
		settled = true
		removeAttachedListeners()
		// Output obeys the strict cap, but reserve a small bounded allowance for
		// the terminal status so a full log never hides completion or failure.
		stream.write(`${message.slice(0, PROCEED_LOG_FINAL_MESSAGE_MAX_CHARS)}\n`)
		stream.end()
		onSettled?.(outcome)
	}

	return {
		path: logFilePath,
		attach: (process) => {
			const onLine = (line: string): void => {
				// Check the cap before writing: a single huge line (e.g. a dumped
				// binary blob or minified bundle) must not blow past the cap.
				if (!tryWriteLine(line)) {
					tryWriteLine(sizeCapMessage)
					process.removeListener("line", onLine)
				}
			}
			const onCompleted = (details?: TerminalCompletionDetails): void => {
				const exitCode = details?.exitCode
				const completionError = details?.terminalClosed
					? "Terminal closed while the command was running"
					: details?.unobservedCommand
						? "Command completion could not be observed"
						: undefined
				const outcome = completionError
					? ({ kind: "failed", error: completionError } as const)
					: ({ kind: "exited", exitCode: exitCode ?? 0 } as const)
				end(
					details?.terminalClosed
						? "[Terminal closed while the command was running; output may be incomplete]"
						: details?.unobservedCommand
							? "[Command completion could not be observed; the command may still be running]"
							: exitCode !== undefined && exitCode !== null
								? `[Command completed with exit code ${exitCode}]`
								: "[Command completed]",
					outcome,
				)
			}
			const onError = (error: Error): void => {
				end(`[Command failed after detaching: ${error.message}]`, { kind: "failed", error: error.message })
			}
			removeAttachedListeners = () => {
				process.removeListener("line", onLine)
				process.removeListener("completed", onCompleted)
				process.removeListener("error", onError)
			}
			if (sizeCapReached) {
				tryWriteLine(sizeCapMessage)
			} else {
				process.on("line", onLine)
			}
			process.once("completed", onCompleted)
			process.once("error", onError)
		},
		fail: (error) => {
			const message = error instanceof Error ? error.message : String(error)
			end(`[Command failed before log capture completed: ${message}]`, { kind: "failed", error: message })
		},
	}
}

type DetachReason = RunCommandDetachKind

function formatDetachedResult(logFilePath: string, output: string, reason: DetachReason): string {
	return [
		reason === "user"
			? "The user chose to proceed while the command is starting or still running in their terminal."
			: `The command was still starting or running after ${FOREGROUND_COMMAND_AUTO_PROCEED_MS / 1000} seconds, so Cline automatically proceeded while leaving it running in the terminal.`,
		`This is partial output; further output is being redirected to this file, which you can read to check progress: ${logFilePath}`,
		output.length > 0 ? `Output so far:\n${output}` : "No output so far.",
	].join("\n")
}

type PreStartControl = "detach" | "abort"

/** Exported for direct unit testing of the CommandExitError/terminalClosed mapping. */
export async function executeForeground(
	command: ShellCommand,
	cwd: string,
	terminalManager: VscodeTerminalManager,
	maxOutputChars: number,
	abortSignal?: AbortSignal,
	commandExecutions?: VscodeRunCommandExecutionController,
	terminalProfileId?: string,
	context?: AgentToolContext,
	limits: ShellExecutionLimits = VSCODE_RUN_COMMAND_EXECUTION_PROFILES.vscodeTerminal,
): Promise<string> {
	const terminalCommand = formatCommandForTerminal(command)
	const executionId = randomUUID()
	const emitUpdate = (update: Record<string, unknown>): void => context?.emitUpdate?.({ executionId, ...update })
	const emitDetachedCompletion = (kind: RunCommandDetachKind, outcome: ForegroundCompletionOutcome): void => {
		const logPath = detachedLog?.path ?? ""
		if (context?.sessionId && commandExecutions) {
			commandExecutions?.reportDetachedCommandCompleted({
				sessionId: context.sessionId,
				executionId,
				toolCallId: context.toolCallId,
				logPath,
				detachKind: kind,
				outcome,
				ts: Date.now(),
			})
		} else {
			emitUpdate({ detached: true, completed: true, detachKind: kind, outcome, logPath, stream: "stdout", chunk: "" })
		}
	}

	// "Proceed While Running": register a per-invocation handle so the user can
	// detach this command. If they do not act, automatically detach after the
	// foreground profile's soft deadline so a long-running command cannot block
	// the agent turn indefinitely.
	// Detaching redirects the remaining output to a log file and resolves the
	// awaited promise; the command keeps running in the user's terminal (and the
	// terminal stays busy until it completes).
	//
	// Registered BEFORE terminal acquisition so every command in a parallel
	// run_commands batch is registered before the user can click the button.
	// A command still awaiting its terminal when the user detaches records the
	// request and applies it the moment its process starts — otherwise that
	// late command would re-block the turn the button just released.
	const state: { phase: "waiting" | "started" | "detached" | "aborted" } = { phase: "waiting" }
	let detachedLog: DetachedCommandLog | undefined
	let detachReason: DetachReason | undefined
	let applyDetach: ((reason: DetachReason) => void) | undefined
	let resolvePreStartControl!: (control: PreStartControl) => void
	const preStartControl = new Promise<PreStartControl>((resolve) => {
		resolvePreStartControl = resolve
	})
	const requestDetach = (reason: DetachReason): void => {
		if (state.phase === "waiting") {
			state.phase = "detached"
			detachReason = reason
			detachedLog = createDetachedCommandLog(terminalCommand, [], (outcome) => emitDetachedCompletion(reason, outcome))
			if (reason === "user") {
				telemetryService.captureTerminalUserIntervention(TerminalUserInterventionAction.PROCESS_WHILE_RUNNING, "vscode")
			}
			resolvePreStartControl("detach")
		} else if (state.phase === "started") {
			applyDetach?.(reason)
		}
	}
	const unregister = commandExecutions?.register({
		executionId,
		sessionId: context?.sessionId ?? "",
		toolCallId: context?.toolCallId,
		detach: (kind) => {
			if (state.phase === "detached" || state.phase === "aborted") {
				return false
			}
			requestDetach(kind)
			return true
		},
	})
	const autoProceedTimer =
		Number.isFinite(limits.detachAfterMs) &&
		(!Number.isFinite(limits.killAfterMs) || (limits.killAfterMs ?? 0) > (limits.detachAfterMs ?? 0))
			? setTimeout(() => requestDetach("implicit"), limits.detachAfterMs)
			: undefined
	emitUpdate({ stream: "stdout", chunk: "", detachable: true })
	const onAbort = (): void => {
		if (state.phase === "waiting") {
			state.phase = "aborted"
			resolvePreStartControl("abort")
		} else if (state.phase === "started") {
			applyAbort?.()
		}
	}
	let applyAbort: (() => void) | undefined
	abortSignal?.addEventListener("abort", onAbort, { once: true })
	if (abortSignal?.aborted) {
		onAbort()
	}

	try {
		const terminalPromise = terminalManager.getOrCreateTerminal(cwd, terminalProfileId)
		const startDetached = (terminalInfo: Awaited<typeof terminalPromise>, log: DetachedCommandLog): void => {
			try {
				const process = terminalManager.runCommand(terminalInfo, terminalCommand)
				log.attach(process)
				void process.catch((error) => log.fail(error))
				process.detach()
			} catch (error) {
				log.fail(error)
			}
		}
		const acquisition = terminalPromise.then(
			(terminalInfo) => ({ type: "terminal" as const, terminalInfo }),
			(error: unknown) => ({ type: "error" as const, error }),
		)
		const finishDetachedAcquisition = (outcome: Awaited<typeof acquisition>, log: DetachedCommandLog): void => {
			if (outcome.type === "terminal") {
				startDetached(outcome.terminalInfo, log)
			} else {
				log.fail(outcome.error)
			}
		}
		const finishAbortedAcquisition = (outcome: Awaited<typeof acquisition>): void => {
			if (outcome.type === "terminal") {
				terminalManager.releaseTerminalReservation(outcome.terminalInfo)
			}
		}
		const firstOutcome = await Promise.race([
			acquisition,
			preStartControl.then((control) => ({ type: "control" as const, control })),
		])

		if (firstOutcome.type === "control") {
			if (firstOutcome.control === "abort") {
				// Acquisition is already in flight and may return a synchronously
				// reserved terminal after this tool result settles. Consume it so a
				// pre-start cancellation cannot leave that terminal permanently busy.
				void acquisition.then(finishAbortedAcquisition)
				throw new Error("Command execution aborted")
			}

			const log = detachedLog
			if (!log) {
				throw new Error("Detached command log was not initialized")
			}
			void acquisition.then((outcome) => finishDetachedAcquisition(outcome, log))
			emitUpdate({
				detached: true,
				detachKind: detachReason,
				logPath: log.path,
				detachable: false,
				stream: "stdout",
				chunk: "",
			})
			return formatDetachedResult(log.path, "", detachReason ?? "implicit")
		}

		// Acquisition and a user action can resolve in the same microtask turn.
		// Re-check the invocation phase after the await so an already-queued
		// terminal outcome cannot overwrite a detach or abort that happened while
		// the promise continuation was pending.
		if (state.phase === "aborted") {
			finishAbortedAcquisition(firstOutcome)
			throw new Error("Command execution aborted")
		}
		if (state.phase === "detached") {
			const log = detachedLog
			if (!log) {
				throw new Error("Detached command log was not initialized")
			}
			finishDetachedAcquisition(firstOutcome, log)
			emitUpdate({
				detached: true,
				detachKind: detachReason,
				logPath: log.path,
				detachable: false,
				stream: "stdout",
				chunk: "",
			})
			return formatDetachedResult(log.path, "", detachReason ?? "implicit")
		}
		if (firstOutcome.type === "error") {
			throw firstOutcome.error
		}

		state.phase = "started"
		const { terminalInfo } = firstOutcome

		const process = terminalManager.runCommand(terminalInfo, terminalCommand)
		const outputLines: string[] = []
		let droppedLines = 0

		// Accumulate output lines to return the full output once the command completes.
		// The chat shows command output at completion, not incrementally.
		//
		// This is a second buffer on top of the process's own `fullOutput` (capped at
		// MAX_FULL_OUTPUT_SIZE — see VscodeTerminalProcess), so it needs its own cap:
		// a long-running command emitting many lines must not accumulate them here
		// without bound. Once the cap is hit, keep only the head and tail — matching
		// truncateCommandOutput's own head/tail strategy below — since build/test
		// failures usually appear at the end of output.
		const maxBufferedLines = MAX_UNRETRIEVED_LINES
		const bufferLine = (line: string): void => {
			if (outputLines.length < maxBufferedLines) {
				outputLines.push(line)
			} else {
				outputLines.shift()
				outputLines.push(line)
				droppedLines++
			}
			emitUpdate({ stream: "stdout", chunk: `${line}\n`, detachable: true })
		}
		process.on("line", bufferLine)

		try {
			applyAbort = () => {
				// A cancelled task must actually stop the running command, not just
				// stop observing it. VS Code has no API to kill a terminal's
				// foreground process, so send Ctrl+C (SIGINT) before detaching our
				// listeners; continue() alone would leave the command running in the
				// user's terminal after cancellation.
				try {
					terminalManager.sendInterrupt(terminalInfo)
				} catch (error) {
					Logger.warn(
						`[VscodeRunCommands] Failed to interrupt command on cancellation: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
				}
				process.continue()
			}

			applyDetach = (reason) => {
				if (detachedLog !== undefined) {
					return
				}
				detachReason = reason
				detachedLog = createDetachedCommandLog(terminalCommand, outputLines, (outcome) =>
					emitDetachedCompletion(reason, outcome),
				)
				detachedLog.attach(process)
				if (reason === "user") {
					telemetryService.captureTerminalUserIntervention(
						TerminalUserInterventionAction.PROCESS_WHILE_RUNNING,
						"vscode",
					)
				}
				// detach() flushes any partial line (reaching both bufferLine and
				// the log) before resolving the awaited promise. After that the
				// partial output is final: stop buffering so the remaining
				// (log-only) output doesn't mutate outputLines while it's read.
				process.detach()
				process.removeListener("line", bufferLine)
				emitUpdate({
					detached: true,
					detachKind: reason,
					logPath: detachedLog.path,
					detachable: false,
					stream: "stdout",
					chunk: "",
				})
			}

			// Wait for completion (or detach, which also resolves the promise)
			await process

			if (abortSignal?.aborted) {
				throw new Error("Command execution aborted")
			}

			const bufferedOutput =
				droppedLines > 0
					? [...outputLines, `\n... (${droppedLines} earlier lines dropped) ...\n`].join("\n")
					: outputLines.join("\n")
			const output = truncateCommandOutput(bufferedOutput.trim(), {
				maxChars: maxOutputChars,
			})

			if (detachedLog !== undefined) {
				return formatDetachedResult(detachedLog.path, output, detachReason ?? "implicit")
			}

			const completionDetails = process.getCompletionDetails?.()

			// A terminal closed mid-command has no exit code and no reliable output —
			// whatever the command was doing (e.g. running a test suite) was interrupted,
			// so this must never look like success to the agent.
			if (completionDetails?.terminalClosed) {
				const result =
					output.length > 0
						? `[Terminal closed while the command was running; output may be incomplete]\n${output}`
						: "[Terminal closed while the command was running; no output was captured]"
				throw new CommandExitError(1, result)
			}

			if (completionDetails?.unobservedCommand) {
				const disposition = getUnobservedTerminalCommandDisposition(completionDetails.unobservedCommand)
				const lifecycle =
					disposition === "disposeBeforeNextTerminalAcquisition"
						? "The terminal remains open for now, but starting another foreground command will attempt to close it, stopping the command if it is still running."
						: "The terminal has been left open and will not be closed automatically."
				const result =
					output.length > 0
						? `[Command completion could not be observed; the command may still be running and must not be assumed to have succeeded. ${lifecycle}]\n${output}`
						: `[Command completion could not be observed; the command may still be running and must not be assumed to have succeeded. ${lifecycle}]`
				throw new CommandExitError(1, result)
			}

			// Plumb the exit code from onDidEndTerminalShellExecution through to the tool
			// result. When shell integration reports a non-zero exit code, throw
			// CommandExitError so the SDK's shell tool wrapper marks the result as
			// `success: false` and includes the exit code in the error message —
			// matching the background (child_process) executor's behavior.
			// If no exit code was captured after an observed completion, return the
			// output as-is. Unobserved completion is handled explicitly above.
			const exitCode = completionDetails?.exitCode
			if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
				const result =
					output.length > 0
						? `[Command exited with code ${exitCode}]\n${output}`
						: `[Command exited with code ${exitCode}]`
				throw new CommandExitError(exitCode, result)
			}

			emitUpdate({
				stream: "stdout",
				chunk: "",
				completed: true,
				detachable: false,
				outcome: { kind: "exited", exitCode: exitCode ?? 0 },
			})
			return output
		} finally {
			process.removeListener("line", bufferLine)
		}
	} catch (error) {
		if (state.phase !== "detached") {
			emitUpdate({
				stream: "stdout",
				chunk: "",
				completed: true,
				detachable: false,
				outcome: { kind: "failed", error: error instanceof Error ? error.message : String(error) },
			})
		}
		throw error
	} finally {
		if (autoProceedTimer) clearTimeout(autoProceedTimer)
		abortSignal?.removeEventListener("abort", onAbort)
		unregister?.()
	}
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * The shell selected by the user's terminal profile setting at one moment:
 * the profile ID for foreground terminal creation and the shell executable
 * it resolves to for background spawning and description building.
 */
interface ShellSnapshot {
	profileId: string
	shell: string
}

/** Resolves the shell the user's terminal profile setting selects right now. */
function takeShellSnapshot(): ShellSnapshot {
	// The setting is typed string, but guard empty values the same way the
	// settings handlers do (they skip persisting "" but older stores may hold one).
	const profileId = StateManager.get().getGlobalSettingsKey("defaultTerminalProfile") || "default"
	return { profileId, shell: getShellForProfile(profileId) }
}

/**
 * Creates the custom `run_commands` tool for the VSCode extension.
 *
 * This tool suppresses and replaces the SDK's built-in `run_commands` tool.
 * The terminal execution mode is captured when the session's tool set is
 * built; switching modes rebuilds the active SDK session so the tool timeout
 * and execution path follow it.
 *
 * The shell is snapshotted each time the runtime reads the tool description,
 * which happens when a model request is built. Tool calls produced by that
 * request execute with the same snapshot, so changing the terminal profile
 * while the model is generating does not change the shell under commands the
 * model has already planned: the new shell is named in the next request (the
 * one carrying these tool results) and used by the commands it produces.
 */
export function createVscodeRunCommandsTool(options: VscodeRunCommandsToolOptions): AgentTool {
	const state = { snapshot: takeShellSnapshot() }
	return createShellTool(createVscodeShellExecutor(options, state), {
		cwd: options.cwd,
		bashTimeoutMs: options.bashTimeoutMs,
		shell: () => {
			state.snapshot = takeShellSnapshot()
			return state.snapshot.shell
		},
	})
}

function createVscodeShellExecutor(options: VscodeRunCommandsToolOptions, state: { snapshot: ShellSnapshot }): ShellExecutor {
	const { cwd, getTerminalManager } = options
	const executionMode = options.vscodeTerminalExecutionMode ?? "vscodeTerminal"

	// Lazy-init background executor — recreated when the snapshotted shell changes.
	let bgExecutor: ShellExecutor | undefined
	let bgExecutorShell: string | undefined

	// Lazy-init terminal manager reference
	let terminalManager: VscodeTerminalManager | undefined

	return async (command, commandCwd, context): Promise<string> => {
		Logger.log(`[VscodeRunCommands] Executing command in ${executionMode} mode`)

		// Execute with the shell named in the model request that produced this
		// tool call, not the setting's current value (see createVscodeRunCommandsTool).
		const { profileId, shell } = state.snapshot

		if (executionMode === "backgroundExec") {
			// Background path — use SDK's createShellExecutor.
			// Recreate the executor if the shell has changed
			if (!bgExecutor || bgExecutorShell !== shell) {
				bgExecutorShell = shell
				bgExecutor = createShellExecutor({
					shell,
					// Set SHELL env to match the shell we're spawning so child
					// processes see the correct value instead of the inherited parent's.
					env: { SHELL: shell },
					executionController: options.commandExecutions,
					detachAfterMs: VSCODE_RUN_COMMAND_EXECUTION_PROFILES.backgroundExec.detachAfterMs,
					killAfterMs: VSCODE_RUN_COMMAND_EXECUTION_PROFILES.backgroundExec.killAfterMs,
				})
				Logger.log(`[VscodeRunCommands] Background executor using shell: ${shell}`)
			}
			// Record execution outcomes so background mode is comparable with
			// foreground mode in the same task.terminal_execution event.
			try {
				const result = await bgExecutor(
					command,
					commandCwd || cwd,
					context,
					VSCODE_RUN_COMMAND_EXECUTION_PROFILES.backgroundExec,
				)
				telemetryService.captureTerminalExecution(true, "vscode", "child_process", {
					exitCode: 0,
					terminalExecutionMode: "backgroundExec",
				})
				return result
			} catch (error) {
				telemetryService.captureTerminalExecution(false, "vscode", "child_process", {
					...(error instanceof CommandExitError && { exitCode: error.exitCode }),
					terminalExecutionMode: "backgroundExec",
				})
				throw error
			}
		}

		// Foreground path — use VscodeTerminalManager
		if (!terminalManager) {
			terminalManager = getTerminalManager()
		}
		return await executeForeground(
			command,
			commandCwd || cwd,
			terminalManager,
			MAX_COMMAND_OUTPUT_CHARS,
			context.signal,
			options.commandExecutions,
			profileId,
			context,
			VSCODE_RUN_COMMAND_EXECUTION_PROFILES.vscodeTerminal,
		)
	}
}
