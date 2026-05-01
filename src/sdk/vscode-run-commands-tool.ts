/**
 * Custom `run_commands` tool that replaces the SDK's built-in version.
 *
 * This is an IDE-level feature built on top of the SDK, NOT part of the SDK.
 * It supports two execution modes, switchable dynamically per invocation:
 *
 *   - **Foreground (vscodeTerminal):** Uses VscodeTerminalManager for visible
 *     VS Code terminals with shell integration, no hard timeout, real-time
 *     output streaming via onChange, and "Proceed While Running" support.
 *
 *   - **Background (backgroundExec):** Delegates to the SDK's createBashExecutor()
 *     for headless child_process.spawn execution with a configurable timeout.
 *
 * See sdk-migration/FOREGROUND-TERMINAL-DESIGN.md for the full design rationale.
 */

import { createDefaultExecutors } from "@clinebot/core"
import { createTool, type Tool, type ToolContext } from "@clinebot/shared"
import { StateManager } from "@/core/storage/StateManager"
import type { ITerminalManager } from "@/integrations/terminal/types"
import { Logger } from "@/shared/services/Logger"
import { getShellForProfile } from "@/utils/shell"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The result shape returned per command — matches the SDK's ToolOperationResult. */
interface CommandResult {
	query: string
	result: string
	success: boolean
	error?: string
}

/** Options for creating the VSCode run_commands tool. */
export interface VscodeRunCommandsToolOptions {
	/** Workspace root directory. */
	cwd: string
	/** Lazy factory for the VscodeTerminalManager. Called once on first foreground use. */
	getTerminalManager: () => ITerminalManager
	/** Timeout for background execution in milliseconds. Default: 300_000 (5 min). */
	backgroundTimeoutMs?: number
	/** Max output bytes for background execution. Default: 1_000_000. */
	backgroundMaxOutputBytes?: number
}

// ---------------------------------------------------------------------------
// Background executor (lazy singleton per tool instance)
// ---------------------------------------------------------------------------

function createBackgroundExecutor(opts: {
	timeoutMs: number
	maxOutputBytes: number
	shell: string
}): (command: string, cwd: string, context: ToolContext) => Promise<string> {
	const executors = createDefaultExecutors({
		bash: {
			timeoutMs: opts.timeoutMs,
			maxOutputBytes: opts.maxOutputBytes,
			shell: opts.shell,
			// Set SHELL env to match the shell we're spawning so child
			// processes see the correct value instead of the inherited parent's.
			env: { SHELL: opts.shell },
		},
	})
	return executors.bash!
}

// ---------------------------------------------------------------------------
// Input parsing — handles all SDK input formats
// ---------------------------------------------------------------------------

function parseCommands(input: unknown): string[] {
	if (typeof input === "string") {
		return [input]
	}
	if (Array.isArray(input)) {
		return input.map(String)
	}
	if (input && typeof input === "object") {
		const obj = input as Record<string, unknown>
		if ("commands" in obj) {
			const cmds = obj.commands
			if (typeof cmds === "string") return [cmds]
			if (Array.isArray(cmds)) return cmds.map(String)
		}
		if ("command" in obj && typeof obj.command === "string") {
			return [obj.command]
		}
		if ("cmd" in obj && typeof obj.cmd === "string") {
			return [obj.cmd]
		}
	}
	return []
}

// ---------------------------------------------------------------------------
// Foreground execution — VscodeTerminalManager
// ---------------------------------------------------------------------------

async function executeForeground(
	command: string,
	cwd: string,
	terminalManager: ITerminalManager,
	abortSignal?: AbortSignal,
	onChange?: (update: unknown) => void,
): Promise<CommandResult> {
	try {
		const terminalInfo = await terminalManager.getOrCreateTerminal(cwd)
		terminalInfo.terminal.show()

		const process = terminalManager.runCommand(terminalInfo, command)

		const outputLines: string[] = []
		let completed = false
		let continued = false

		// Stream output lines via onChange for real-time UI updates
		process.on("line", (line: string) => {
			outputLines.push(line)
			if (onChange) {
				onChange({ type: "output", line })
			}
		})

		process.once("completed", () => {
			completed = true
		})

		process.once("continue", () => {
			continued = true
		})

		// Handle abort signal
		if (abortSignal) {
			const onAbort = () => {
				process.continue()
			}
			abortSignal.addEventListener("abort", onAbort, { once: true })
			process.once("completed", () => abortSignal.removeEventListener("abort", onAbort))
			process.once("continue", () => abortSignal.removeEventListener("abort", onAbort))
		}

		// Wait for completion or continue
		await process

		const output = terminalManager.processOutput(outputLines)

		if (completed) {
			return {
				query: command,
				result: output || "(no output)",
				success: true,
			}
		}
		// User clicked "Proceed While Running" or signal aborted
		return {
			query: command,
			result: `Command is still running in the user's terminal.${output ? `\n\nOutput so far:\n${output}` : ""}`,
			success: true,
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		return {
			query: command,
			result: "",
			error: `Command failed: ${msg}`,
			success: false,
		}
	}
}

// ---------------------------------------------------------------------------
// Background execution — SDK's createBashExecutor
// ---------------------------------------------------------------------------

async function executeBackground(
	command: string,
	cwd: string,
	executor: (command: string, cwd: string, context: ToolContext) => Promise<string>,
	context: ToolContext,
): Promise<CommandResult> {
	try {
		const output = await executor(command, cwd, context)
		return {
			query: command,
			result: output || "(no output)",
			success: true,
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		return {
			query: command,
			result: "",
			error: `Command failed: ${msg}`,
			success: false,
		}
	}
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Creates the custom `run_commands` tool for the VSCode extension.
 *
 * This tool suppresses and replaces the SDK's built-in `run_commands` tool.
 * It reads `vscodeTerminalExecutionMode` from StateManager on every invocation
 * to dynamically switch between foreground (visible terminal) and background
 * (child_process.spawn) execution.
 */
export function createVscodeRunCommandsTool(options: VscodeRunCommandsToolOptions): Tool {
	const { cwd, getTerminalManager, backgroundTimeoutMs = 300_000, backgroundMaxOutputBytes = 1_000_000 } = options

	// Lazy-init background executor — recreated when the user's shell profile changes.
	let bgExecutor: ((command: string, cwd: string, context: ToolContext) => Promise<string>) | undefined
	let bgExecutorShell: string | undefined

	// Lazy-init terminal manager reference
	let terminalManager: ITerminalManager | undefined

	return createTool({
		name: "run_commands",
		description:
			"Run shell commands from the root of the workspace. " +
			"Use for listing files, checking git status, running builds, executing tests, etc. " +
			"Commands should be properly shell-escaped.",
		inputSchema: {
			type: "object",
			properties: {
				commands: {
					anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
					description: "Shell command(s) to execute.",
				},
			},
			required: ["commands"],
		},
		// No enforced timeout — we manage our own (or none for foreground)
		timeoutMs: 3_600_000, // 1 hour metadata hint; not enforced externally
		retryable: false,
		maxRetries: 0,
		execute: async (input: unknown, context: ToolContext, onChange?: (update: unknown) => void) => {
			const commands = parseCommands(input)
			if (commands.length === 0) {
				return [{ query: "(empty)", result: "", error: "No commands provided", success: false }]
			}

			// Read current execution mode dynamically
			const mode = StateManager.get().getGlobalStateKey("vscodeTerminalExecutionMode") ?? "vscodeTerminal"

			Logger.log(`[VscodeRunCommands] Executing ${commands.length} command(s) in ${mode} mode`)

			if (mode === "backgroundExec") {
				// Background path — use SDK's createBashExecutor
				// Resolve shell from the user's terminal profile setting
				const profileId = (StateManager.get().getGlobalSettingsKey("defaultTerminalProfile") as string) || "default"
				const shell = getShellForProfile(profileId)

				// Recreate the executor if the shell has changed
				if (!bgExecutor || bgExecutorShell !== shell) {
					bgExecutorShell = shell
					bgExecutor = createBackgroundExecutor({
						timeoutMs: backgroundTimeoutMs,
						maxOutputBytes: backgroundMaxOutputBytes,
						shell,
					})
					Logger.log(`[VscodeRunCommands] Background executor using shell: ${shell}`)
				}
				const results = await Promise.all(commands.map((cmd) => executeBackground(cmd, cwd, bgExecutor!, context)))
				return results
			}
			// Foreground path — use VscodeTerminalManager
			if (!terminalManager) {
				terminalManager = getTerminalManager()
			}
			// Execute commands sequentially in foreground (terminal reuse)
			const results: CommandResult[] = []
			for (const cmd of commands) {
				const result = await executeForeground(cmd, cwd, terminalManager, context.abortSignal, onChange)
				results.push(result)
				// If aborted, stop executing remaining commands
				if (context.abortSignal?.aborted) {
					break
				}
			}
			return results
		},
	})
}
