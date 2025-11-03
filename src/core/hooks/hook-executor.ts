import { ClineMessage } from "@shared/ExtensionMessage"
import { MessageStateHandler } from "../task/message-state"
import { HookExecutionError } from "./HookError"
import { HookFactory, HookStreamCallback } from "./hook-factory"

export interface HookExecutionOptions<Name extends keyof Hooks = any> {
	hookName: Name
	hookInput: Hooks[Name]
	isCancellable: boolean
	say: (type: any, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>
	setActiveHookExecution?: (execution: {
		hookName: string
		toolName: string | undefined
		messageTs: number
		abortController: AbortController
		scriptPath?: string
	}) => Promise<void>
	clearActiveHookExecution?: (messageTs: number) => Promise<void>
	messageStateHandler: MessageStateHandler
	taskId: string
	hooksEnabled: boolean
	toolName?: string // Optional tool name for PreToolUse/PostToolUse hooks
	pendingToolInfo?: any // Optional metadata about pending tool execution for PreToolUse
}

// Import Hooks type from HookFactory
type Hooks = import("./hook-factory").Hooks

export interface HookExecutionResult {
	cancel?: boolean
	contextModification?: string
	errorMessage?: string
	wasCancelled: boolean
}

/**
 * Executes a hook with standardized error handling, status tracking, and cleanup.
 * This consolidates the common pattern used across all hook execution sites.
 *
 * When multiple hooks exist (e.g., global + workspace), each hook gets its own
 * background terminal with separate output streaming.
 */
export async function executeHook<Name extends keyof Hooks>(options: HookExecutionOptions<Name>): Promise<HookExecutionResult> {
	const {
		hookName,
		hookInput,
		isCancellable,
		say,
		setActiveHookExecution,
		clearActiveHookExecution,
		messageStateHandler,
		taskId,
		hooksEnabled,
	} = options

	// Early return if hooks are disabled
	if (!hooksEnabled) {
		return {
			wasCancelled: false,
		}
	}

	// Discover all hook scripts for this hook type
	const hookFactory = new HookFactory()
	const hookScripts = await hookFactory.discoverHookScripts(hookName)

	if (hookScripts.length === 0) {
		return {
			wasCancelled: false,
		}
	}

	// Create hook messages sequentially to ensure unique timestamps
	// (but execute the hooks themselves in parallel for performance)
	const hookExecutions: Array<Promise<HookExecutionResult>> = []

	for (const scriptPath of hookScripts) {
		// Create the hook message first (sequentially to get unique timestamp)
		const hookMetadata = {
			hookName,
			scriptPath,
			...(options.toolName && { toolName: options.toolName }),
			status: "running",
			...(options.pendingToolInfo && { pendingToolInfo: options.pendingToolInfo }),
		}
		const hookMessageTs = await say("hook", JSON.stringify(hookMetadata))

		// Add small delay to ensure different timestamps even on fast systems
		await new Promise((resolve) => setTimeout(resolve, 1))

		// Log for debugging
		console.log(`[Hook ${hookName}] Created message ts=${hookMessageTs} for ${scriptPath}`)

		// Now start the hook execution (don't await - let them run in parallel)
		const execution = executeIndividualHook({
			scriptPath,
			hookName,
			hookInput,
			isCancellable,
			say,
			setActiveHookExecution,
			clearActiveHookExecution,
			messageStateHandler,
			taskId,
			toolName: options.toolName,
			pendingToolInfo: options.pendingToolInfo,
			hookMessageTs, // Pass the pre-created timestamp
		})

		hookExecutions.push(execution)
	}

	// Wait for all hook executions to complete in parallel
	const results = await Promise.all(hookExecutions)

	// Merge results:
	// - If ANY hook was cancelled by user, return wasCancelled: true
	// - If ANY hook requests task cancellation, return cancel: true
	// - Combine all context modifications
	// - Combine all error messages

	const wasCancelled = results.some((r) => r.wasCancelled)
	const cancel = results.some((r) => r.cancel === true)
	const contextModification = results
		.map((r) => r.contextModification?.trim())
		.filter((mod) => mod)
		.join("\n\n")
	const errorMessage = results
		.map((r) => r.errorMessage?.trim())
		.filter((msg) => msg)
		.join("\n")

	return {
		cancel: cancel || undefined,
		contextModification: contextModification || undefined,
		errorMessage: errorMessage || undefined,
		wasCancelled,
	}
}

/**
 * Execute a single hook script with its own terminal message and output stream.
 */
async function executeIndividualHook<Name extends keyof Hooks>(params: {
	scriptPath: string
	hookName: Name
	hookInput: Hooks[Name]
	isCancellable: boolean
	say: (type: any, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>
	setActiveHookExecution?: (execution: {
		hookName: string
		toolName: string | undefined
		messageTs: number
		abortController: AbortController
		scriptPath?: string
	}) => Promise<void>
	clearActiveHookExecution?: (messageTs: number) => Promise<void>
	messageStateHandler: MessageStateHandler
	taskId: string
	toolName?: string
	pendingToolInfo?: any
	hookMessageTs?: number // Pre-created timestamp for this hook message
}): Promise<HookExecutionResult> {
	const {
		scriptPath,
		hookName,
		hookInput,
		isCancellable,
		say,
		setActiveHookExecution,
		clearActiveHookExecution,
		messageStateHandler,
		taskId,
		toolName,
		pendingToolInfo,
		hookMessageTs: providedHookMessageTs,
	} = params

	let hookMessageTs: number | undefined = providedHookMessageTs
	const abortController = new AbortController()

	try {
		// Only create hook message if not already created
		if (hookMessageTs === undefined) {
			const hookMetadata = {
				hookName,
				scriptPath, // Include script path to identify which hook this is
				...(toolName && { toolName }),
				status: "running",
				...(pendingToolInfo && { pendingToolInfo }),
			}
			hookMessageTs = await say("hook", JSON.stringify(hookMetadata))
		}

		// Track active hook execution for cancellation (only if cancellable and message was created)
		if (isCancellable && hookMessageTs !== undefined && setActiveHookExecution) {
			await setActiveHookExecution({
				hookName,
				toolName,
				messageTs: hookMessageTs,
				abortController,
				scriptPath,
			})
		}

		// Create dedicated output channel for this hook (pub-sub architecture)
		// The channel handles routing outputs to the correct hook message
		const outputChannel = new (await import("./HookOutputChannel")).HookOutputChannel(hookMessageTs!, say)

		// Create streaming callback that publishes to the channel
		// Channel internally handles the timestamp prefixing for routing
		const streamCallback: HookStreamCallback = async (line: string) => {
			await outputChannel.publish(line)
		}

		// Create runner directly for THIS SPECIFIC SCRIPT ONLY
		// Don't use createWithStreaming() as it rediscovers all scripts!
		const { StdioHookRunner } = await import("./hook-factory")
		const hook = new StdioHookRunner(hookName, scriptPath, streamCallback, isCancellable ? abortController.signal : undefined)

		const result = await hook.run({
			taskId,
			...hookInput,
		})

		console.log(`[${hookName} Hook - ${scriptPath}]`, result)

		// Check if hook wants to cancel
		if (result.cancel === true) {
			// Update hook status to cancelled
			if (hookMessageTs !== undefined) {
				await updateHookMessage(messageStateHandler, hookMessageTs, {
					hookName,
					scriptPath,
					...(toolName && { toolName }),
					status: "cancelled",
					exitCode: 130,
					hasJsonResponse: true,
				})
			}

			return {
				cancel: true,
				contextModification: result.contextModification,
				errorMessage: result.errorMessage,
				wasCancelled: false,
			}
		}

		// Clear active hook execution after successful completion (only if cancellable)
		if (isCancellable && clearActiveHookExecution && hookMessageTs !== undefined) {
			await clearActiveHookExecution(hookMessageTs)
		}

		// Update hook status to completed (only if not cancelled)
		if (hookMessageTs !== undefined) {
			await updateHookMessage(messageStateHandler, hookMessageTs, {
				hookName,
				scriptPath,
				...(toolName && { toolName }),
				status: "completed",
				exitCode: 0,
				hasJsonResponse: true,
			})
		}

		return {
			cancel: result.cancel,
			contextModification: result.contextModification,
			errorMessage: result.errorMessage,
			wasCancelled: false,
		}
	} catch (hookError) {
		// Clear active hook execution (only if cancellable)
		if (isCancellable && clearActiveHookExecution && hookMessageTs !== undefined) {
			await clearActiveHookExecution(hookMessageTs)
		}

		// Check if this was a user cancellation via abort controller
		if (abortController.signal.aborted) {
			// Update hook status to cancelled
			if (hookMessageTs !== undefined) {
				await updateHookMessage(messageStateHandler, hookMessageTs, {
					hookName,
					scriptPath,
					status: "cancelled",
					exitCode: 130,
				})
			}

			return {
				cancel: true,
				wasCancelled: true,
			}
		}

		// Update hook status to failed for actual errors
		// Extract structured error info if available
		const isStructuredError = HookExecutionError.isHookError(hookError)
		const errorInfo = isStructuredError ? hookError.errorInfo : null

		if (hookMessageTs !== undefined) {
			await updateHookMessage(messageStateHandler, hookMessageTs, {
				hookName,
				scriptPath,
				status: "failed",
				exitCode: errorInfo?.exitCode ?? 1,
				...(errorInfo && {
					error: {
						type: errorInfo.type,
						message: errorInfo.message,
						details: errorInfo.details,
						scriptPath: errorInfo.scriptPath,
					},
				}),
			})
		}

		// Log error for non-cancellable hooks or unexpected errors
		console.error(`${hookName} hook failed (${scriptPath}):`, hookError)

		// Return safe defaults for all fields to avoid undefined property access
		return {
			cancel: false,
			contextModification: undefined,
			errorMessage: undefined,
			wasCancelled: false,
		}
	}
}

/**
 * Helper to update hook message status in message state
 */
async function updateHookMessage(
	messageStateHandler: MessageStateHandler,
	hookMessageTs: number,
	metadata: Record<string, any>,
): Promise<void> {
	const clineMessages = messageStateHandler.getClineMessages()
	const hookMessageIndex = clineMessages.findIndex((m: ClineMessage) => m.ts === hookMessageTs)
	if (hookMessageIndex !== -1) {
		await messageStateHandler.updateClineMessage(hookMessageIndex, {
			text: JSON.stringify(metadata),
		})
	}
}
