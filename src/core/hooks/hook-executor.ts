import { ClineMessage } from "@shared/ExtensionMessage"
import { MessageStateHandler } from "../task/message-state"
import { HookExecutionError } from "./HookError"
import { HookFactory } from "./hook-factory"

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
	}) => Promise<void>
	clearActiveHookExecution?: () => Promise<void>
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

	// Check if the hook exists
	const hookFactory = new HookFactory()
	const hasHook = await hookFactory.hasHook(hookName)

	if (!hasHook) {
		return {
			wasCancelled: false,
		}
	}

	let hookMessageTs: number | undefined
	const abortController = new AbortController()

	try {
		// Show hook execution indicator and capture timestamp
		const hookMetadata = {
			hookName,
			...(options.toolName && { toolName: options.toolName }),
			status: "running",
			...(options.pendingToolInfo && { pendingToolInfo: options.pendingToolInfo }),
		}
		hookMessageTs = await say("hook", JSON.stringify(hookMetadata))

		// Track active hook execution for cancellation (only if cancellable and message was created)
		if (isCancellable && hookMessageTs !== undefined && setActiveHookExecution) {
			await setActiveHookExecution({
				hookName,
				toolName: options.toolName,
				messageTs: hookMessageTs,
				abortController,
			})
		}

		// Create streaming callback
		const streamCallback = async (line: string) => {
			await say("hook_output", line)
		}

		// Create and execute hook
		const hook = await hookFactory.createWithStreaming(
			hookName,
			streamCallback,
			isCancellable ? abortController.signal : undefined,
		)

		const result = await hook.run({
			taskId,
			...hookInput,
		})

		console.log(`[${hookName} Hook]`, result)

		// Check if hook wants to cancel
		if (result.cancel === true) {
			// Update hook status to cancelled
			if (hookMessageTs !== undefined) {
				await updateHookMessage(messageStateHandler, hookMessageTs, {
					hookName,
					...(options.toolName && { toolName: options.toolName }),
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
		if (isCancellable && clearActiveHookExecution) {
			await clearActiveHookExecution()
		}

		// Update hook status to completed (only if not cancelled)
		if (hookMessageTs !== undefined) {
			await updateHookMessage(messageStateHandler, hookMessageTs, {
				hookName,
				...(options.toolName && { toolName: options.toolName }),
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
		if (isCancellable && clearActiveHookExecution) {
			await clearActiveHookExecution()
		}

		// Check if this was a user cancellation via abort controller
		if (abortController.signal.aborted) {
			// Update hook status to cancelled
			if (hookMessageTs !== undefined) {
				await updateHookMessage(messageStateHandler, hookMessageTs, {
					hookName,
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
		console.error(`${hookName} hook failed:`, hookError)

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
