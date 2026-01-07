import fs from "fs/promises"
import path from "path"
import { version as clineVersion } from "../../../package.json"
import { getDistinctId } from "../../services/logging/distinctId"
import { telemetryService } from "../../services/telemetry"
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
import { HookExecutionError } from "./HookError"
import { HookProcess } from "./HookProcess"

// Hook execution timeout (30 seconds)
const HOOK_EXECUTION_TIMEOUT_MS = 30000

// Maximum size for context modification (to prevent prompt overflow)
const MAX_CONTEXT_MODIFICATION_SIZE = 50000 // ~50KB

// Exit code indicating cancellation/interruption (Unix SIGINT convention: 128 + signal 2)
const EXIT_CODE_SIGINT = 130

/**
 * Validates hook output JSON structure.
 * Ensures required fields are present and have correct types.
 */
function validateHookOutput(output: any): { valid: boolean; error?: string } {
	// Check if deprecated shouldContinue field is present
	if (output.shouldContinue !== undefined) {
		return {
			valid: false,
			error:
				"Invalid hook output: The 'shouldContinue' field has been removed.\n\n" +
				"Use 'cancel: true' instead to trigger task cancellation.\n\n" +
				"Migration guide:\n" +
				"  Before: { shouldContinue: false, errorMessage: '...' }\n" +
				"  After:  { cancel: true, errorMessage: '...' }\n\n" +
				"Example valid response:\n" +
				JSON.stringify(
					{
						cancel: false,
						contextModification: "Optional context here",
						errorMessage: "",
					},
					null,
					2,
				),
		}
	}

	// cancel is optional, but if provided must be a boolean
	if (output.cancel !== undefined && typeof output.cancel !== "boolean") {
		return {
			valid: false,
			error:
				"Invalid hook output: 'cancel' must be a boolean.\n\n" +
				`Received type: ${typeof output.cancel}\n\n` +
				"Example valid response:\n" +
				JSON.stringify({ cancel: true, errorMessage: "Cancelling task" }, null, 2),
		}
	}

	// contextModification is optional, but if provided must be a string
	if (output.contextModification !== undefined && typeof output.contextModification !== "string") {
		return {
			valid: false,
			error:
				"Invalid hook output: 'contextModification' must be a string.\n\n" +
				`Received type: ${typeof output.contextModification}\n\n` +
				"Example valid response:\n" +
				JSON.stringify({ contextModification: "Context here" }, null, 2),
		}
	}

	// errorMessage is optional, but if provided must be a string
	if (output.errorMessage !== undefined && typeof output.errorMessage !== "string") {
		return {
			valid: false,
			error:
				"Invalid hook output: 'errorMessage' must be a string.\n\n" +
				`Received type: ${typeof output.errorMessage}\n\n` +
				"Example valid response:\n" +
				JSON.stringify({ cancel: true, errorMessage: "Error description" }, null, 2),
		}
	}

	return { valid: true }
}

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
	 * @returns A successful hook output (no cancellation)
	 */
	override async [exec](_: HookInput): Promise<HookOutput> {
		// HookOutput is a protobuf-generated type with non-optional fields.
		// Protobuf defaults: cancel=false, contextModification="", errorMessage=""
		return HookOutput.create({ cancel: false })
	}
}

/**
 * Callback type for streaming hook output
 */
export type HookStreamCallback = (
	line: string,
	stream: "stdout" | "stderr",
	meta?: {
		source: "global" | "workspace"
		scriptPath: string
	},
) => void

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
 * - Emits per-hook telemetry with source attribution (global or workspace)
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
		private readonly source: "global" | "workspace",
		private readonly streamCallback?: HookStreamCallback,
		private readonly abortSignal?: AbortSignal,
		private readonly taskId?: string,
		private readonly toolName?: string,
	) {
		super(hookName)
	}

	override async [exec](input: HookInput): Promise<HookOutput> {
		const startTime = performance.now()
		const taskId = this.taskId // Local const for type narrowing in closures

		// Capture telemetry at the start of individual hook execution
		if (taskId) {
			telemetryService.safeCapture(
				() =>
					telemetryService.captureHookExecution(taskId, this.hookName, "started", {
						source: this.source,
						toolName: this.toolName,
					}),
				"HookFactory.exec.started",
			)
		}

		// Check if already aborted before starting
		if (this.abortSignal?.aborted) {
			throw HookExecutionError.cancellation(this.scriptPath)
		}

		// Serialize input to JSON
		// NOTE: Proto3 by default omits empty strings (default values) from toJSON()
		// To ensure hooks receive consistent data (e.g., {"prompt": ""} instead of {}),
		// we manually construct the JSON object and explicitly include empty string fields
		const jsonObj = HookInput.toJSON(input) as Record<string, any>

		// Ensure empty prompt strings are preserved in UserPromptSubmit data
		if (jsonObj.userPromptSubmit && jsonObj.userPromptSubmit.prompt === undefined) {
			jsonObj.userPromptSubmit.prompt = ""
		}

		const inputJson = JSON.stringify(jsonObj)

		// Create HookProcess for execution with streaming
		const hookProcess = new HookProcess(this.scriptPath, HOOK_EXECUTION_TIMEOUT_MS, this.abortSignal)

		// Set up streaming if callback is provided
		if (this.streamCallback) {
			const callback = this.streamCallback
			hookProcess.on("line", (line: string, stream: "stdout" | "stderr") => {
				// NOTE: HookProcess emits a synthetic empty line (""), used as a "start of output" marker.
				// Preserve it for now so downstream can keep existing behavior.
				callback(line, stream, {
					source: this.source,
					scriptPath: this.scriptPath,
				})
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

					// Validate structure before creating HookOutput
					const validation = validateHookOutput(outputData)
					if (!validation.valid) {
						// Return null to indicate parsing failed, let caller decide what to do based on exit code
						return null
					}

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
				} catch (parseError) {
					// Try to extract JSON from stdout (it might have debug output before/after)
					// Scan from the end to find the last complete JSON object
					// This handles cases where hooks output debug info before the actual JSON response

					const lines = stdout.split("\n")
					let jsonCandidate = ""
					let braceCount = 0
					let startCollecting = false

					// Scan from the end to find the last complete JSON object
					for (let i = lines.length - 1; i >= 0; i--) {
						const line = lines[i].trimEnd()

						// Count braces to track JSON object boundaries
						for (let j = line.length - 1; j >= 0; j--) {
							if (line[j] === "}") {
								braceCount++
								if (!startCollecting) {
									startCollecting = true
								}
							} else if (line[j] === "{") {
								braceCount--
							}
						}

						if (startCollecting) {
							jsonCandidate = line + "\n" + jsonCandidate
						}

						// If we've closed all braces, we have a complete JSON object
						if (startCollecting && braceCount === 0) {
							break
						}
					}

					if (jsonCandidate.trim()) {
						try {
							// Trim everything before the first opening bracket
							const trimmedCandidate = jsonCandidate.trim()
							const firstBraceIndex = trimmedCandidate.indexOf("{")
							const cleanedJson =
								firstBraceIndex !== -1 ? trimmedCandidate.slice(firstBraceIndex) : trimmedCandidate

							const outputData = JSON.parse(cleanedJson)

							// Validate structure
							const validation = validateHookOutput(outputData)
							if (!validation.valid) {
								// Return null to indicate parsing failed
								return null
							}

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
							// Couldn't extract valid JSON, return null
							return null
						}
					}

					// Couldn't parse JSON at all, return null
					return null
				}
			}

			const parsedOutput = parseJsonOutput()

			// If we have valid JSON, honor it regardless of exit code
			if (parsedOutput) {
				const durationMs = performance.now() - startTime

				// Log warning if non-zero exit but valid JSON (for developers)
				if (exitCode !== 0) {
					console.warn(`[Hook ${this.hookName}] Exited with code ${exitCode} but provided valid JSON response`)
					if (stderr) {
						console.warn(`[Hook ${this.hookName}] stderr: ${stderr}`)
					}
				}

				// Capture success/cancellation telemetry
				if (taskId) {
					if (parsedOutput.cancel) {
						telemetryService.safeCapture(
							() =>
								telemetryService.captureHookExecution(taskId, this.hookName, "completed", {
									source: this.source,
									toolName: this.toolName,
									durationMs,
									exitCode: exitCode ?? EXIT_CODE_SIGINT,
									cancelRequested: true,
									contextModified: !!parsedOutput.contextModification,
									contextSize: parsedOutput.contextModification?.length,
								}),
							"HookFactory.exec.completed.cancel",
						)
					} else {
						telemetryService.safeCapture(
							() =>
								telemetryService.captureHookExecution(taskId, this.hookName, "completed", {
									source: this.source,
									toolName: this.toolName,
									durationMs,
									exitCode: exitCode ?? 0,
									cancelRequested: false,
									contextModified: !!parsedOutput.contextModification,
									contextSize: parsedOutput.contextModification?.length,
								}),
							"HookFactory.exec.completed.success",
						)
					}
				}

				return parsedOutput
			}

			// No valid JSON found
			if (exitCode === 0) {
				// Hook succeeded but didn't provide JSON - allow execution (no cancellation)
				console.warn(`[Hook ${this.hookName}] Completed successfully but no JSON response found`)
				const durationMs = performance.now() - startTime

				// Capture success telemetry even without JSON
				if (taskId) {
					telemetryService.safeCapture(
						() =>
							telemetryService.captureHookExecution(taskId, this.hookName, "completed", {
								source: this.source,
								toolName: this.toolName,
								durationMs,
								exitCode: 0,
								cancelRequested: false,
								contextModified: false,
							}),
						"HookFactory.exec.completed.noJson",
					)
				}

				return HookOutput.create({
					cancel: false,
				})
			} else {
				// Hook failed with non-zero exit - include hook name in error
				throw HookExecutionError.execution(this.scriptPath, exitCode ?? 1, stderr, this.hookName)
			}
		} catch (error) {
			const durationMs = performance.now() - startTime

			// If it's already a HookExecutionError, re-throw it
			if (HookExecutionError.isHookError(error)) {
				// Capture failure telemetry based on error type
				if (taskId) {
					if (error.errorInfo.type === "cancellation") {
						telemetryService.safeCapture(
							() =>
								telemetryService.captureHookExecution(taskId, this.hookName, "cancelled", {
									source: this.source,
									toolName: this.toolName,
								}),
							"HookFactory.exec.error.cancellation",
						)
					} else if (error.errorInfo.type === "timeout") {
						telemetryService.safeCapture(
							() =>
								telemetryService.captureHookExecution(taskId, this.hookName, "failed", {
									source: this.source,
									toolName: this.toolName,
									durationMs,
									errorType: "timeout",
									errorMessage: error.message,
								}),
							"HookFactory.exec.error.timeout",
						)
					} else {
						telemetryService.safeCapture(
							() =>
								telemetryService.captureHookExecution(taskId, this.hookName, "failed", {
									source: this.source,
									toolName: this.toolName,
									durationMs,
									exitCode: error.errorInfo.exitCode ?? 1,
									errorType: error.errorInfo.type as "execution" | "timeout" | "validation",
									errorMessage: error.message,
								}),
							"HookFactory.exec.error.failed",
						)
					}
				}
				throw error
			}

			// Hook execution failed - categorize the error
			const stderr = hookProcess.getStderr()
			const exitCode = hookProcess.getExitCode()

			// Check for timeout
			if (error instanceof Error && error.message.includes("timed out")) {
				if (taskId) {
					telemetryService.safeCapture(
						() =>
							telemetryService.captureHookExecution(taskId, this.hookName, "failed", {
								source: this.source,
								toolName: this.toolName,
								durationMs,
								errorType: "timeout",
								errorMessage: error.message,
							}),
						"HookFactory.exec.catch.timeout",
					)
				}
				throw HookExecutionError.timeout(this.scriptPath, HOOK_EXECUTION_TIMEOUT_MS, stderr, this.hookName)
			}

			// Check for cancellation
			if (error instanceof Error && error.message.includes("cancelled")) {
				if (taskId) {
					telemetryService.safeCapture(
						() =>
							telemetryService.captureHookExecution(taskId, this.hookName, "cancelled", {
								source: this.source,
								toolName: this.toolName,
							}),
						"HookFactory.exec.catch.cancelled",
					)
				}
				throw HookExecutionError.cancellation(this.scriptPath, this.hookName)
			}

			// Generic execution error - include hook name
			if (taskId) {
				telemetryService.safeCapture(
					() =>
						telemetryService.captureHookExecution(taskId, this.hookName, "failed", {
							source: this.source,
							toolName: this.toolName,
							durationMs,
							exitCode: exitCode ?? 1,
							errorType: "execution",
							errorMessage: error instanceof Error ? error.message : String(error),
						}),
					"HookFactory.exec.catch.execution",
				)
			}
			throw HookExecutionError.execution(this.scriptPath, exitCode ?? 1, stderr, this.hookName)
		}
	}
}

/**
 * Combines multiple hook runners and executes them in parallel.
 *
 * Used in multi-root workspaces where both global hooks (from ~/Documents/Cline/Hooks/)
 * and workspace-specific hooks (from each workspace's .clinerules/hooks/) exist for the
 * same hook type.
 *
 * Behavior:
 * - Executes all hooks concurrently using Promise.all
 * - If ANY hook returns cancel: true, the merged result will have cancel: true
 * - Concatenates all contextModification strings with double newlines
 * - Concatenates all errorMessage strings with single newlines
 *
 * This means if ANY hook requests cancellation, the task will be cancelled.
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
		// - If any hook requests cancellation, set cancel to true
		// - Combine context contributions from all hooks
		// - Collect any error messages

		const cancel = results.some((result) => result.cancel === true)
		const contextModification = results
			.map((result) => result.contextModification?.trim())
			.filter((mod) => mod)
			.join("\n\n")
		const errorMessage = results
			.map((result) => result.errorMessage?.trim())
			.filter((msg) => msg)
			.join("\n")

		return HookOutput.create({
			cancel,
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
	 * Get information about discovered hooks including their script paths
	 * @param hookName The type of hook to query
	 * @returns Object containing array of script paths
	 */
	async getHookInfo<Name extends HookName>(
		hookName: Name,
	): Promise<{
		scriptPaths: string[]
	}> {
		const { HookDiscoveryCache } = await import("./HookDiscoveryCache")
		const scripts = await HookDiscoveryCache.getInstance().get(hookName)
		return { scriptPaths: scripts }
	}

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
	async create<Name extends HookName>(hookName: Name, taskId?: string, toolName?: string): Promise<HookRunner<Name>> {
		return this.createWithStreaming(hookName, undefined, undefined, taskId, toolName)
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
	 * @param taskId Optional task ID for telemetry context
	 * @param toolName Optional tool name for telemetry context
	 * @returns A HookRunner that executes the hook(s), or NoOpRunner if none found
	 */
	async createWithStreaming<Name extends HookName>(
		hookName: Name,
		streamCallback?: HookStreamCallback,
		abortSignal?: AbortSignal,
		taskId?: string,
		toolName?: string,
	): Promise<HookRunner<Name>> {
		// Use cache for hook discovery instead of direct file system scan
		const { HookDiscoveryCache } = await import("./HookDiscoveryCache")
		const scripts = await HookDiscoveryCache.getInstance().get(hookName)

		// Fetch hooks dirs once for source determination and telemetry
		const hooksDirs = await getAllHooksDirs()

		// Capture hook discovery telemetry
		// Categorize scripts by location (global vs workspace)
		const { globalCount, workspaceCount } = this.categorizeHookScripts(scripts, hooksDirs)
		if (scripts.length > 0) {
			telemetryService.safeCapture(
				() => telemetryService.captureHookDiscovery(hookName, globalCount, workspaceCount),
				"HookFactory.createWithStreaming.discovery",
			)
		}

		// Create runners with source determination for each script
		const runners = scripts.map((script) => {
			const source = this.determineScriptSource(script, hooksDirs)
			return new StdioHookRunner(hookName, script, source, streamCallback, abortSignal, taskId, toolName)
		})

		if (runners.length === 0) {
			return new NoOpRunner(hookName)
		}
		return runners.length === 1 ? runners[0] : new CombinedHookRunner(hookName, runners)
	}

	/**
	 * Checks if a hooks directory is a global hooks directory.
	 * Global hooks are located in paths containing "Cline/Hooks" or "cline/hooks".
	 */
	private static isGlobalHooksDir(dir: string): boolean {
		return /[/\\][Cc]line[/\\][Hh]ooks/i.test(dir)
	}

	/**
	 * Determines if a single script is from global or workspace location
	 */
	private determineScriptSource(scriptPath: string, hooksDirs: string[]): "global" | "workspace" {
		const containingDir = hooksDirs.find((dir) => scriptPath.startsWith(dir))
		if (containingDir && HookFactory.isGlobalHooksDir(containingDir)) {
			return "global"
		}
		return "workspace" // Default to workspace if uncertain
	}

	/**
	 * Categorizes hook scripts by their location (global vs workspace).
	 * Global hooks are located in ~/Documents/Cline/Hooks/
	 * Workspace hooks are located in workspace .clinerules/hooks/ directories
	 *
	 * @param scripts Array of hook script paths
	 * @param hooksDirs Array of hooks directories (passed to avoid redundant fetches)
	 * @returns Object with globalCount and workspaceCount
	 */
	private categorizeHookScripts(scripts: string[], hooksDirs: string[]): { globalCount: number; workspaceCount: number } {
		if (scripts.length === 0) {
			return { globalCount: 0, workspaceCount: 0 }
		}

		let globalCount = 0
		let workspaceCount = 0

		for (const script of scripts) {
			const containingDir = hooksDirs.find((dir) => script.startsWith(dir))
			if (containingDir && HookFactory.isGlobalHooksDir(containingDir)) {
				globalCount++
			} else {
				workspaceCount++
			}
		}

		return { globalCount, workspaceCount }
	}

	/**
	 * @returns A list of paths to scripts for the given hook name.
	 * Includes both global hooks (from ~/Documents/Cline/Hooks/) and workspace hooks
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
