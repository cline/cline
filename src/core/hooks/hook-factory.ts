import fs from "fs/promises"
import path from "path"
import { version as clineVersion } from "../../../package.json"
import { getDistinctId } from "../../services/logging/distinctId"
import {
	HookInput,
	HookOutput,
	PostToolUseData,
	PreCompactData,
	PreToolUseData,
	TaskCancelData,
	TaskCompleteData,
	TaskResumeData,
	TaskStartData,
	UserPromptSubmitData,
} from "../../shared/proto/cline/hooks"
import { getAllHooksDirs } from "../storage/disk"
import { StateManager } from "../storage/StateManager"
import { HookProcess } from "./HookProcess"

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
	UserPromptSubmit: {
		userPromptSubmit: UserPromptSubmitData
	}
	TaskStart: {
		taskStart: TaskStartData
	}
	TaskResume: {
		taskResume: TaskResumeData
	}
	TaskCancel: {
		taskCancel: TaskCancelData
	}
	TaskComplete: {
		taskComplete: TaskCompleteData
	}
	PreCompact: {
		preCompact: PreCompactData
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

	/**
	 * Completes the hook input by adding common metadata to caller-provided parameters.
	 *
	 * This method enriches the hook-specific input (like preToolUse or postToolUse data)
	 * with standard information that all hooks receive:
	 * - clineVersion: Current Cline extension version
	 * - hookName: The type of hook being executed (e.g., "PreToolUse")
	 * - timestamp: Execution time in milliseconds since epoch
	 * - workspaceRoots: Array of workspace folder paths
	 * - userId: Cline user ID, machine ID, or generated UUID
	 *
	 * This separation allows hook scripts to receive consistent metadata without
	 * requiring callers to manually provide it each time.
	 *
	 * @param params The hook-specific input parameters (taskId + hook data)
	 * @returns Complete HookInput ready to be serialized and sent to the hook script
	 */
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

/**
 * NoOpRunner is a null-object pattern implementation used when no hook scripts are found.
 *
 * Instead of returning null or requiring null checks everywhere, we return a NoOpRunner
 * that always succeeds immediately without any side effects. This simplifies the calling
 * code and ensures hooks are always optional/gracefully degraded.
 *
 * @template Name The type of hook this runner represents
 */
class NoOpRunner<Name extends HookName> extends HookRunner<Name> {
	/**
	 * Executes a no-op hook that always succeeds.
	 * @param _ Hook input (ignored)
	 * @returns A successful hook output with shouldContinue: true
	 */
	override async [exec](_: HookInput): Promise<HookOutput> {
		return HookOutput.create({
			shouldContinue: true,
		})
	}
}

/**
 * Callback type for streaming hook output
 */
export type HookStreamCallback = (line: string, stream: "stdout" | "stderr") => void

/**
 * Executes a hook script as a child process with real-time output streaming.
 *
 * Key features:
 * - Spawns the hook script and communicates via stdin/stdout/stderr
 * - Streams output line-by-line via callback for real-time UI updates
 * - Enforces 30-second timeout (configurable via HOOK_EXECUTION_TIMEOUT_MS)
 * - Supports cancellation via AbortSignal
 * - Parses JSON output from stdout, attempting to extract it even if mixed with debug output
 * - Truncates context modifications that exceed 50KB to prevent prompt overflow
 * - Handles both successful and failed executions gracefully
 *
 * Error handling:
 * - Treats hooks as "fail-open": only shouldContinue:false blocks tool execution
 * - Hook script errors (non-zero exit) don't block tools, only explicit JSON response does
 * - Timeout/cancellation errors are propagated to show "Failed" status in UI
 *
 * @template Name The type of hook this runner represents
 */
class StdioHookRunner<Name extends HookName> extends HookRunner<Name> {
	constructor(
		hookName: Name,
		public readonly scriptPath: string,
		private readonly streamCallback?: HookStreamCallback,
		private readonly abortSignal?: AbortSignal,
	) {
		super(hookName)
	}

	override async [exec](input: HookInput): Promise<HookOutput> {
		// Check if already aborted before starting
		if (this.abortSignal?.aborted) {
			throw new Error("Hook execution cancelled before start")
		}

		// Serialize input to JSON
		const inputJson = JSON.stringify(HookInput.toJSON(input))

		// Create HookProcess for execution with streaming
		const hookProcess = new HookProcess(this.scriptPath, HOOK_EXECUTION_TIMEOUT_MS, this.abortSignal)

		// Set up streaming if callback is provided
		if (this.streamCallback) {
			const callback = this.streamCallback
			hookProcess.on("line", (line: string, stream: "stdout" | "stderr") => {
				callback(line, stream)
			})
		}

		try {
			// Execute the hook and wait for completion
			await hookProcess.run(inputJson)

			// Get the complete stdout for JSON parsing
			const stdout = hookProcess.getStdout()
			const stderr = hookProcess.getStderr()
			const exitCode = hookProcess.getExitCode()

			// Try to parse JSON output
			const parseJsonOutput = (): HookOutput | null => {
				try {
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

					return output
				} catch (_parseError) {
					// Try to extract JSON from stdout (it might have debug output before/after)
					const jsonMatch = stdout.match(/\{[\s\S]*\}/)
					if (jsonMatch) {
						try {
							const outputData = JSON.parse(jsonMatch[0])
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

							return output
						} catch (_extractError) {
							return null
						}
					}
					return null
				}
			}

			const parsedOutput = parseJsonOutput()

			// If we have valid JSON, honor it regardless of exit code
			if (parsedOutput) {
				if (exitCode !== 0 && this.streamCallback) {
					// Log that hook exited non-zero but we're using the JSON
					this.streamCallback(
						`\n⚠️  Note: Hook exited with code ${exitCode} but provided valid JSON response.`,
						"stderr",
					)
					if (stderr) {
						this.streamCallback(`    stderr: ${stderr}`, "stderr")
					}
				}
				return parsedOutput
			}

			// No valid JSON found
			if (exitCode === 0) {
				// Hook succeeded but didn't provide JSON
				if (this.streamCallback) {
					this.streamCallback(
						`\n⚠️  Warning: Hook completed successfully but no JSON response found in output.`,
						"stderr",
					)
					this.streamCallback(`    No context will be added to the conversation.`, "stderr")
				}
				return HookOutput.create({
					shouldContinue: true,
				})
			} else {
				// Hook failed - throw error so UI shows "Failed" status
				const errorDetails = stderr ? `. stderr: ${stderr}` : ""
				throw new Error(`Hook exited with code ${exitCode}${errorDetails}`)
			}
		} catch (error) {
			// Hook execution failed (timeout, cancellation, or fatal error)
			const stderr = hookProcess.getStderr()
			const _exitCode = hookProcess.getExitCode()

			// Re-throw the error so ToolExecutor sees "Failed" status in UI
			// ToolExecutor will catch this and decide whether to block tool execution
			// (Only shouldContinue: false blocks execution)
			if (error instanceof Error) {
				const errorDetails = stderr ? `. stderr: ${stderr}` : ""
				// Include hook name in error message for better debugging
				const hookPrefix = this.hookName ? `${this.hookName} hook: ` : ""
				throw new Error(`${hookPrefix}${error.message}${errorDetails}`)
			}
			throw error
		}
	}
}

/**
 * Combines multiple hook runners and executes them in parallel.
 *
 * Used in multi-root workspaces where both global hooks (from ~/Documents/Cline/Rules/Hooks/)
 * and workspace-specific hooks (from each workspace's .clinerules/hooks/) exist for the
 * same hook type.
 *
 * Behavior:
 * - Executes all hooks concurrently using Promise.all
 * - Combines all shouldContinue flags with logical AND (all must be true to continue)
 * - Concatenates all contextModification strings with double newlines
 * - Concatenates all errorMessage strings with single newlines
 *
 * This means if ANY hook returns shouldContinue: false, tool execution is blocked.
 * All hooks' context contributions are merged into the conversation.
 *
 * @template Name The type of hook this runner represents
 */
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
	/**
	 * Check if any hook scripts exist for the given hook name
	 * @returns true if at least one hook script exists, false otherwise
	 */
	async hasHook<Name extends HookName>(hookName: Name): Promise<boolean> {
		const scripts = await HookFactory.findHookScripts(hookName)
		return scripts.length > 0
	}

	/**
	 * Create a hook runner without streaming support (backwards compatible)
	 */
	async create<Name extends HookName>(hookName: Name): Promise<HookRunner<Name>> {
		return this.createWithStreaming(hookName)
	}

	/**
	 * Create a hook runner with optional streaming callback and abort signal support.
	 *
	 * This is the primary factory method for creating hooks. It:
	 * 1. Uses HookDiscoveryCache to find hook scripts (fast O(1) lookup after first scan)
	 * 2. Creates StdioHookRunner instances for each discovered script
	 * 3. Returns NoOpRunner if no scripts found (null-object pattern)
	 * 4. Returns CombinedHookRunner if multiple scripts found (parallel execution)
	 *
	 * The streaming callback receives hook output line-by-line in real-time, allowing
	 * the UI to display progress as the hook executes. The abort signal enables
	 * cancellation of long-running hooks.
	 *
	 * @param hookName The type of hook to create (e.g., "PreToolUse", "PostToolUse")
	 * @param streamCallback Optional callback for real-time output streaming
	 * @param abortSignal Optional signal to cancel hook execution
	 * @returns A HookRunner that executes the hook(s), or NoOpRunner if none found
	 */
	async createWithStreaming<Name extends HookName>(
		hookName: Name,
		streamCallback?: HookStreamCallback,
		abortSignal?: AbortSignal,
	): Promise<HookRunner<Name>> {
		// Use cache for hook discovery instead of direct file system scan
		const { HookDiscoveryCache } = await import("./HookDiscoveryCache")
		const scripts = await HookDiscoveryCache.getInstance().get(hookName)

		const runners = scripts.map((script) => new StdioHookRunner(hookName, script, streamCallback, abortSignal))
		if (runners.length === 0) {
			return new NoOpRunner(hookName)
		}
		return runners.length === 1 ? runners[0] : new CombinedHookRunner(hookName, runners)
	}

	/**
	 * @returns A list of paths to scripts for the given hook name.
	 * Includes both global hooks (from ~/Documents/Cline/Rules/Hooks/) and workspace hooks
	 * (from .clinerules/hooks/ in each workspace root).
	 */
	private static async findHookScripts(hookName: HookName): Promise<string[]> {
		const hookScripts = []
		for (const hooksDir of await getAllHooksDirs()) {
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
	static async findHookInHooksDir(hookName: HookName, hooksDir: string): Promise<string | undefined> {
		return process.platform === "win32"
			? HookFactory.findWindowsHook(hookName, hooksDir)
			: HookFactory.findUnixHook(hookName, hooksDir)
	}

	/**
	 * Finds a hook on Windows using git-style hook discovery.
	 * Like git, we look for a file with the hook name (no extension) and execute it
	 * through the shell, which handles shebangs and script interpretation.
	 *
	 * @param hookName the name of the hook to search for
	 * @param hooksDir the hooks directory path to search
	 * @returns the path to the hook to execute, or undefined if none found
	 * @throws Error if an unexpected file system error occurs
	 */
	private static async findWindowsHook(hookName: HookName, hooksDir: string): Promise<string | undefined> {
		const candidate = path.join(hooksDir, hookName)

		try {
			const stat = await fs.stat(candidate)
			return stat.isFile() ? candidate : undefined
		} catch (error) {
			HookFactory.handleHookDiscoveryError(error, hookName, candidate)
			// Expected error (file doesn't exist), return undefined
			return undefined
		}
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
