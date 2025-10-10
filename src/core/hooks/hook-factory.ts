import { spawn } from "node:child_process"
import fs from "fs/promises"
import path from "path"
import { version as clineVersion } from "../../../package.json"
import { getDistinctId } from "../../services/logging/distinctId"
import { HookInput, HookOutput, PostToolUseData, PreToolUseData } from "../../shared/proto/cline/hooks"
import { getWorkspaceHooksDirs } from "../storage/disk"
import { StateManager } from "../storage/StateManager"

// Hook execution timeout (30 seconds)
const HOOK_EXECUTION_TIMEOUT_MS = 30000

// Maximum size for context modification (to prevent prompt overflow)
const MAX_CONTEXT_MODIFICATION_SIZE = 50000 // ~50KB

export interface Hooks {
	PreToolUse: {
		preToolUse: PreToolUseData
	}
	PostToolUse: {
		postToolUse: PostToolUseData
	}
}

// The names of all supported hooks. Hooks[N] is the type of data the hook takes as input.
type HookName = keyof Hooks

/**
 * The hook input parameters for a named hook. These are the parameters the caller must
 * provide--the other common parameters like clineVersion and userId are handled by the
 * hook system.
 */
export type NamedHookInput<Name extends HookName> = {
	taskId: string
} & Hooks[Name]

// We look up HookRunner.exec via symbol so that the combined hook runner can call
// exec on its sub-runners without completing a new set of parameters for each one.
// See CombinedHookRunner[exec]
const exec = Symbol()

/**
 * Runs a hook script and returns the result.
 *
 * Design: HookRunner is stateless and reusable. Each call to run() is independent
 * and returns a fresh HookOutput. This design is appropriate because:
 * - Hooks are executed on-demand per tool use
 * - No need to maintain execution history within the runner
 * - ToolExecutor creates new instances as needed
 * - Results are immediately consumed and added to the conversation context
 */
export abstract class HookRunner<Name extends HookName> {
	constructor(public readonly hookName: Name) {}

	/**
	 * Execute the hook with the given parameters.
	 * This method is stateless and can be called multiple times safely.
	 * @param params Hook-specific parameters (taskId, preToolUse/postToolUse data)
	 * @returns The hook output containing shouldContinue, contextModification, and errorMessage
	 */
	async run(params: NamedHookInput<Name>): Promise<HookOutput> {
		const input = HookInput.create(await this.completeParams(params))
		return this[exec](input)
	}

	abstract [exec](params: HookInput): Promise<HookOutput>

	// Completes the hook input parameters by adding the common hook parameters to the
	// hook-specific parameters provided by the caller.
	protected async completeParams(params: NamedHookInput<Name>): Promise<HookInput> {
		const workspaceRoots =
			StateManager.get()
				.getGlobalStateKey("workspaceRoots")
				?.map((root) => root.path) || []
		return {
			clineVersion,
			hookName: this.hookName,
			timestamp: Date.now().toString(),
			workspaceRoots,
			userId: getDistinctId(), // Always available: Cline User ID, machine ID, or generated UUID
			...params,
		}
	}
}

// The NoOpRunner is used when there's no hook to run. It immediately succeeds.
class NoOpRunner<Name extends HookName> extends HookRunner<Name> {
	override async [exec](_: HookInput): Promise<HookOutput> {
		return HookOutput.create({
			shouldContinue: true,
		})
	}
}

// Actually runs a hook by executing a script and passing JSON into it.
class StdioHookRunner<Name extends HookName> extends HookRunner<Name> {
	constructor(
		hookName: Name,
		public readonly scriptPath: string,
	) {
		super(hookName)
	}

	override async [exec](input: HookInput): Promise<HookOutput> {
		return new Promise((resolve, reject) => {
			// Serialize input to JSON
			const inputJson = JSON.stringify(HookInput.toJSON(input))

			// Spawn the hook process
			const child = spawn(this.scriptPath, [], {
				stdio: ["pipe", "pipe", "pipe"],
				shell: process.platform === "win32",
			})

			let stdout = ""
			let stderr = ""
			let timeoutHandle: NodeJS.Timeout | undefined

			// Set up timeout
			timeoutHandle = setTimeout(() => {
				child.kill("SIGTERM")
				reject(
					new Error(
						`Hook ${this.hookName} timed out after ${HOOK_EXECUTION_TIMEOUT_MS}ms. The hook script at '${this.scriptPath}' took too long to complete.`,
					),
				)
			}, HOOK_EXECUTION_TIMEOUT_MS)

			// Collect stdout
			child.stdout?.on("data", (data) => {
				stdout += data.toString()
			})

			// Collect stderr
			child.stderr?.on("data", (data) => {
				stderr += data.toString()
			})

			// Handle process completion
			child.on("close", (code) => {
				if (timeoutHandle) {
					clearTimeout(timeoutHandle)
				}

				if (code !== 0) {
					reject(new Error(`Hook ${this.hookName} exited with code ${code}. stderr: ${stderr}`))
					return
				}

				try {
					// Parse and validate output
					const outputData = JSON.parse(stdout)
					const output = HookOutput.fromJSON(outputData)

					// Validate and truncate context modification if too large
					if (output.contextModification && output.contextModification.length > MAX_CONTEXT_MODIFICATION_SIZE) {
						console.warn(
							`Hook ${this.hookName} returned contextModification of ${output.contextModification.length} bytes, ` +
								`truncating to ${MAX_CONTEXT_MODIFICATION_SIZE} bytes`,
						)
						output.contextModification =
							output.contextModification.slice(0, MAX_CONTEXT_MODIFICATION_SIZE) +
							"\n\n[... context truncated due to size limit ...]"
					}

					resolve(output)
				} catch (error) {
					reject(new Error(`Failed to parse hook output: ${error}. stdout: ${stdout}`))
				}
			})

			// Handle process errors
			child.on("error", (error) => {
				if (timeoutHandle) {
					clearTimeout(timeoutHandle)
				}
				reject(new Error(`Failed to execute hook ${this.hookName}: ${error.message}`))
			})

			// Send input to the process
			child.stdin?.write(inputJson)
			child.stdin?.end()
		})
	}
}

// CombinedHookRunner runs multiple hooks and combines the results. Used when a workspace
// has multiple roots contributing the same hook.
class CombinedHookRunner<Name extends HookName> extends HookRunner<Name> {
	constructor(
		hookName: Name,
		private readonly runners: readonly HookRunner<Name>[],
	) {
		super(hookName)
	}

	override async [exec](input: HookInput): Promise<HookOutput> {
		// Run all hooks in parallel
		const results = await Promise.all(this.runners.map((runner) => runner[exec](input)))

		// Merge results:
		// - If any hook indicates execution should stop, then stop
		// - Combine context contributions from all hooks
		// - Collect any error messages

		const shouldContinue = results.every((result) => result.shouldContinue)
		const contextModification = results
			.map((result) => result.contextModification?.trim())
			.filter((mod) => mod)
			.join("\n\n")
		const errorMessage = results
			.map((result) => result.errorMessage?.trim())
			.filter((msg) => msg)
			.join("\n")

		return HookOutput.create({
			shouldContinue,
			contextModification,
			errorMessage,
		})
	}
}

/**
 * Checks if an error encountered during hook discovery is expected and can be safely ignored.
 * Expected errors include file not found, permission denied, and invalid path components.
 *
 * @param error The error to check
 * @returns true if this is an expected error that should be silently handled, false if it should be propagated
 */
function isExpectedHookError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false
	}

	const nodeError = error as NodeJS.ErrnoException

	// Expected: File doesn't exist (most common case)
	if (nodeError.code === "ENOENT") {
		return true
	}

	// Expected: Permission denied (file not executable or not readable)
	// Note: This is expected because users may have hooks in .clinerules that they don't want to execute
	if (nodeError.code === "EACCES") {
		return true
	}

	// Expected: Not a directory (one of the path components isn't a directory)
	if (nodeError.code === "ENOTDIR") {
		return true
	}

	// All other errors (EIO, EMFILE, etc.) are unexpected and should be propagated
	return false
}

export class HookFactory {
	async create<Name extends HookName>(hookName: Name): Promise<HookRunner<Name>> {
		const scripts = await HookFactory.findHookScripts(hookName)
		const runners = scripts.map((script) => new StdioHookRunner(hookName, script))
		if (runners.length === 0) {
			return new NoOpRunner(hookName)
		}
		return runners.length === 1 ? runners[0] : new CombinedHookRunner(hookName, runners)
	}

	/**
	 * @returns A list of paths to scripts for the given hook name.
	 */
	private static async findHookScripts(hookName: HookName): Promise<string[]> {
		const hookScripts = []
		for (const hooksDir of await getWorkspaceHooksDirs()) {
			hookScripts.push(HookFactory.findHookInHooksDir(hookName, hooksDir))
		}
		const isDefined = (scriptPath: string | undefined): scriptPath is string => Boolean(scriptPath)
		return (await Promise.all(hookScripts)).filter(isDefined)
	}

	/**
	 * Finds the path to a hook in a .clinerules hooks directory.
	 *
	 * @param hookName the name of the hook to search for, for example 'PreToolUse'
	 * @param hooksDir the .clinerules directory path to search
	 * @returns the path to the hook to execute, or undefined if none found
	 * @throws Error if an unexpected file system error occurs
	 */
	private static async findHookInHooksDir(hookName: HookName, hooksDir: string): Promise<string | undefined> {
		return process.platform === "win32"
			? HookFactory.findWindowsHook(hookName, hooksDir)
			: HookFactory.findUnixHook(hookName, hooksDir)
	}

	/**
	 * Finds a hook on Windows by searching through PATHEXT extensions.
	 * Windows doesn't have an executable bit, instead files are handed off
	 * to a set of interpreters described in PATHEXT and the Windows registry.
	 *
	 * @param hookName the name of the hook to search for
	 * @param hooksDir the .clinerules directory path to search
	 * @returns the path to the hook to execute, or undefined if none found
	 * @throws Error if an unexpected file system error occurs
	 */
	private static async findWindowsHook(hookName: HookName, hooksDir: string): Promise<string | undefined> {
		// PATHEXT is a ;-delimited list of extensions like .EXE;.COM;.CMD;.BAT etc.
		const pathExts = process.env.PATHEXT?.split(";") || []

		for (const pathExt of pathExts) {
			const candidate = path.join(hooksDir, hookName + pathExt)
			try {
				if ((await fs.stat(candidate)).isFile()) {
					return candidate
				}
			} catch (error) {
				HookFactory.handleHookDiscoveryError(error, hookName, candidate)
				// Expected error (file doesn't exist), continue searching other extensions
			}
		}

		return undefined
	}

	/**
	 * Finds a hook on Unix-like systems (Linux, macOS) by checking for an executable file.
	 *
	 * @param hookName the name of the hook to search for
	 * @param hooksDir the .clinerules directory path to search
	 * @returns the path to the hook to execute, or undefined if none found
	 * @throws Error if an unexpected file system error occurs
	 */
	private static async findUnixHook(hookName: HookName, hooksDir: string): Promise<string | undefined> {
		const candidate = path.join(hooksDir, hookName)

		try {
			const [stat, _] = await Promise.all([fs.stat(candidate), fs.access(candidate, fs.constants.X_OK)])
			return stat.isFile() ? candidate : undefined
		} catch (error) {
			HookFactory.handleHookDiscoveryError(error, hookName, candidate)
			// Expected error (file doesn't exist or not executable), return undefined
			return undefined
		}
	}

	/**
	 * Handles errors encountered during hook discovery.
	 * Expected errors (file not found, permission denied, etc.) are silently ignored.
	 * Unexpected errors are propagated with context.
	 *
	 * @param error the error that occurred
	 * @param hookName the name of the hook being searched for
	 * @param candidate the file path that was being checked
	 * @throws Error if the error is unexpected
	 */
	private static handleHookDiscoveryError(error: unknown, hookName: HookName, candidate: string): void {
		if (!isExpectedHookError(error)) {
			throw new Error(
				`Unexpected error while searching for hook '${hookName}' at '${candidate}': ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}
}
