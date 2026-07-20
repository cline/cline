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

import {
	CommandExitError,
	createShellExecutor,
	createShellTool,
	MAX_COMMAND_OUTPUT_CHARS,
	type ShellExecutor,
	type StructuredCommandInput,
	truncateCommandOutput,
} from "@cline/core"
import type { AgentTool } from "@cline/shared"
import { TerminalUserInterventionAction, telemetryService } from "@services/telemetry"
import { ClineTempManager } from "@services/temp"
import * as fs from "fs"
import { StateManager } from "@/core/storage/StateManager"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { MAX_UNRETRIEVED_LINES } from "@/integrations/terminal/constants"
import type { ITerminalProcess } from "@/integrations/terminal/types"
import { Logger } from "@/shared/services/Logger"
import { getShellForProfile } from "@/utils/shell"
import type { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShellCommand = string | StructuredCommandInput
type VscodeTerminalExecutionMode = "vscodeTerminal" | "backgroundExec"

/** Foreground VS Code terminals cannot be forcibly terminated; give long-running commands room to finish. */
export const VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS = 60 * 60 * 1000

/**
 * Cap on the "Proceed While Running" log file. A detached devserver can log
 * for days; once the cap is hit we stop appending and note the truncation.
 * ClineTempManager's periodic cleanup (age + total-size caps) is the backstop
 * for the files themselves.
 */
export const PROCEED_LOG_MAX_BYTES = 10 * 1024 * 1024

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
	/**
	 * Registry of in-flight foreground executions, owned by SdkController.
	 * When provided, each foreground command can be detached via the
	 * "Proceed While Running" button. Foreground-only: background (SDK
	 * child_process) executions cannot be detached — their abort signal
	 * kills the process tree.
	 */
	foregroundCommands?: SdkForegroundCommandCoordinator
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
 * stream is always closed by the 'completed' event, which the terminal
 * process emits on every exit path (command end, Ctrl+C, terminal closed,
 * markerless fallback).
 */
function beginLogCapture(process: ITerminalProcess, terminalCommand: string, existingLines: string[]): string {
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

	const onLine = (line: string): void => {
		// Check the cap before writing: a single huge line (e.g. a dumped
		// binary blob or minified bundle) must not blow past the cap.
		if (!tryWriteLine(line)) {
			tryWriteLine(sizeCapMessage)
			process.removeListener("line", onLine)
		}
	}
	if (sizeCapReached) {
		tryWriteLine(sizeCapMessage)
	} else {
		process.on("line", onLine)
	}
	process.once("completed", (details) => {
		process.removeListener("line", onLine)
		const exitCode = details?.exitCode
		tryWriteLine(
			exitCode !== undefined && exitCode !== null
				? `[Command completed with exit code ${exitCode}]`
				: "[Command completed]",
		)
		stream.end()
	})

	return logFilePath
}

/** Exported for direct unit testing of the CommandExitError/terminalClosed mapping. */
export async function executeForeground(
	command: ShellCommand,
	cwd: string,
	terminalManager: VscodeTerminalManager,
	maxOutputChars: number,
	abortSignal?: AbortSignal,
	foregroundCommands?: SdkForegroundCommandCoordinator,
	terminalProfileId?: string,
): Promise<string> {
	const terminalCommand = formatCommandForTerminal(command)
	const terminalInfo = await terminalManager.getOrCreateTerminal(cwd, terminalProfileId)
	terminalInfo.terminal.show()

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
	}
	process.on("line", bufferLine)

	// Handle abort signal
	if (abortSignal) {
		const onAbort = () => {
			process.continue()
		}
		const cleanupAbortListener = () => abortSignal.removeEventListener("abort", onAbort)
		abortSignal.addEventListener("abort", onAbort, { once: true })
		process.once("completed", cleanupAbortListener)
		process.once("continue", cleanupAbortListener)
	}

	// "Proceed While Running": register a per-invocation handle so the user
	// can detach this command. Detaching redirects the remaining output to a
	// log file and resolves the awaited promise; the command keeps running in
	// the user's terminal (and the terminal stays busy until it completes).
	let detachedLogFilePath: string | undefined
	const unregister = foregroundCommands?.register({
		detach: () => {
			if (detachedLogFilePath !== undefined) {
				return
			}
			detachedLogFilePath = beginLogCapture(process, terminalCommand, outputLines)
			telemetryService.captureTerminalUserIntervention(TerminalUserInterventionAction.PROCESS_WHILE_RUNNING, "vscode")
			// detach() flushes any partial line (reaching both bufferLine and
			// the log) before resolving the awaited promise. After that the
			// partial output is final: stop buffering so the remaining
			// (log-only) output doesn't mutate outputLines while it's read.
			process.detach()
			process.removeListener("line", bufferLine)
		},
	})

	try {
		// Wait for completion (or detach, which also resolves the promise)
		await process
	} finally {
		unregister?.()
	}
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

	if (detachedLogFilePath !== undefined) {
		return [
			"The user chose to proceed while the command is still running in their terminal.",
			`This is partial output; further output is being redirected to this file, which you can read to check progress: ${detachedLogFilePath}`,
			output.length > 0 ? `Output so far:\n${output}` : "No output so far.",
		].join("\n")
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

	// Plumb the exit code from onDidEndTerminalShellExecution through to the tool
	// result. When shell integration reports a non-zero exit code, throw
	// CommandExitError so the SDK's shell tool wrapper marks the result as
	// `success: false` and includes the exit code in the error message —
	// matching the background (child_process) executor's behavior.
	// If no exit code was captured (shell integration present but not reporting
	// completion for this execution — e.g. a command run inside an ssh session),
	// we can't determine success/failure, so we return the output as-is
	// (success: true).
	const exitCode = completionDetails?.exitCode
	if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
		const result =
			output.length > 0 ? `[Command exited with code ${exitCode}]\n${output}` : `[Command exited with code ${exitCode}]`
		throw new CommandExitError(exitCode, result)
	}

	return output
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
	const executionMode = options.vscodeTerminalExecutionMode ?? "backgroundExec"

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
				})
				Logger.log(`[VscodeRunCommands] Background executor using shell: ${shell}`)
			}
			// Record execution outcomes so background mode is comparable with
			// foreground mode in the same task.terminal_execution event —
			// essential for judging the backgroundExec-by-default change.
			try {
				const result = await bgExecutor(command, commandCwd || cwd, context)
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
			options.foregroundCommands,
			profileId,
		)
	}
}
