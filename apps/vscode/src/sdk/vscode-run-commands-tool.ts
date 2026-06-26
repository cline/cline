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
	createShellExecutor,
	createShellTool,
	MAX_COMMAND_OUTPUT_CHARS,
	type ShellExecutor,
	type StructuredCommandInput,
	truncateCommandOutput,
} from "@cline/core"
import type { AgentTool } from "@cline/shared"
import { StateManager } from "@/core/storage/StateManager"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { Logger } from "@/shared/services/Logger"
import { getShellForProfile } from "@/utils/shell"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShellCommand = string | StructuredCommandInput
type VscodeTerminalExecutionMode = "vscodeTerminal" | "backgroundExec"

/** Foreground VS Code terminals cannot be forcibly terminated; give long-running commands room to finish. */
export const VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS = 60 * 60 * 1000

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

async function executeForeground(
	command: ShellCommand,
	cwd: string,
	terminalManager: VscodeTerminalManager,
	maxOutputChars: number,
	abortSignal?: AbortSignal,
): Promise<string> {
	const terminalCommand = formatCommandForTerminal(command)
	const terminalInfo = await terminalManager.getOrCreateTerminal(cwd)
	terminalInfo.terminal.show()

	const process = terminalManager.runCommand(terminalInfo, terminalCommand)
	const outputLines: string[] = []

	// Accumulate output lines to return the full output once the command completes.
	// The chat shows command output at completion, not incrementally.
	process.on("line", (line: string) => {
		outputLines.push(line)
	})

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

	// Wait for completion
	await process
	if (abortSignal?.aborted) {
		throw new Error("Command execution aborted")
	}

	return truncateCommandOutput(outputLines.join("\n").trim(), {
		maxChars: maxOutputChars,
	})
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Creates the custom `run_commands` tool for the VSCode extension.
 *
 * This tool suppresses and replaces the SDK's built-in `run_commands` tool.
 * The terminal execution mode is captured when the session's tool set is built.
 * Switching modes rebuilds the active SDK session so the tool timeout and
 * execution mode stay aligned.
 */
export function createVscodeRunCommandsTool(options: VscodeRunCommandsToolOptions): AgentTool {
	return createShellTool(createVscodeShellExecutor(options), {
		cwd: options.cwd,
		bashTimeoutMs: options.bashTimeoutMs,
	})
}

function createVscodeShellExecutor(options: VscodeRunCommandsToolOptions): ShellExecutor {
	const { cwd, getTerminalManager } = options
	const executionMode = options.vscodeTerminalExecutionMode ?? "backgroundExec"

	// Lazy-init background executor — recreated when the user's shell profile changes.
	let bgExecutor: ShellExecutor | undefined
	let bgExecutorShell: string | undefined

	// Lazy-init terminal manager reference
	let terminalManager: VscodeTerminalManager | undefined

	return async (command, commandCwd, context): Promise<string> => {
		Logger.log(`[VscodeRunCommands] Executing command in ${executionMode} mode`)

		if (executionMode === "backgroundExec") {
			// Background path — use SDK's createShellExecutor
			// Resolve shell from the user's terminal profile setting
			const profileId = (StateManager.get().getGlobalSettingsKey("defaultTerminalProfile") as string) || "default"
			const shell = getShellForProfile(profileId)

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
			return await bgExecutor(command, commandCwd || cwd, context)
		}

		// Foreground path — use VscodeTerminalManager
		if (!terminalManager) {
			terminalManager = getTerminalManager()
		}
		return await executeForeground(command, commandCwd || cwd, terminalManager, MAX_COMMAND_OUTPUT_CHARS, context.signal)
	}
}
