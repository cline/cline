// Bridges Cline's file-based hook scripts into the SDK's AgentHooks interface.
//
// Maps 4 Cline hooks to SDK lifecycle callbacks:
//   TaskStart    → onSessionStart
//   PreToolUse   → onToolCallStart
//   PostToolUse  → onToolCallEnd
//   TaskComplete → onRunEnd (gated on finishReason === 'completed')
//
// Deferred hooks (NOT wired here): TaskResume, TaskCancel, UserPromptSubmit, PreCompact, Notification.

import type {
	AgentHookControl,
	AgentHookRunEndContext,
	AgentHookSessionStartContext,
	AgentHooks,
	AgentHookToolCallEndContext,
	AgentHookToolCallStartContext,
} from "@clinebot/shared"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { HookFactory } from "@/core/hooks/hook-factory"
import { getHooksEnabledSafe } from "@/core/hooks/hooks-utils"
import type { StateManager } from "@/core/storage/StateManager"

/**
 * Callback type for emitting hook_status ClineMessages to the webview.
 *
 * The SDK invokes AgentHooks callbacks inline (not through onEvent), so
 * the message-translator's `case 'hook':` handler never fires for our
 * adapter hooks. This emitter lets the hooks-adapter push hook_status
 * messages directly to the webview via the SdkController.
 */
export type HookMessageEmitter = (message: ClineMessage) => void

/**
 * Safely coerce an `unknown` SDK tool input into `Record<string, string>`.
 *
 * Hook scripts expect string-valued parameter maps. If the input is already
 * a plain object we stringify each value; otherwise we return an empty map.
 */
function toStringRecord(input: unknown): Record<string, string> {
	if (input == null || typeof input !== "object" || Array.isArray(input)) {
		return {}
	}
	const result: Record<string, string> = {}
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		result[key] = typeof value === "string" ? value : JSON.stringify(value)
	}
	return result
}

/**
 * Map a Cline HookOutput to SDK AgentHookControl (or undefined when no-op).
 */
function mapHookResult(hookOutput: { cancel: boolean; contextModification: string }): AgentHookControl | undefined {
	const hasCancel = hookOutput.cancel
	const hasContext = hookOutput.contextModification && hookOutput.contextModification.length > 0

	if (!hasCancel && !hasContext) {
		return undefined
	}

	return {
		cancel: hasCancel || undefined,
		context: hasContext ? hookOutput.contextModification : undefined,
	}
}

/**
 * Build a hook_status ClineMessage for the webview's HookMessage component.
 *
 * The `text` field is JSON matching the HookMetadata interface expected by
 * `webview-ui/src/components/chat/HookMessage.tsx`.
 */
function buildHookStatusMessage(opts: {
	hookName: string
	status: "running" | "completed" | "failed" | "cancelled"
	toolName?: string
}): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "hook_status",
		text: JSON.stringify({
			hookName: opts.hookName,
			...(opts.toolName && { toolName: opts.toolName }),
			status: opts.status,
		}),
		partial: false,
	}
}

/**
 * Build an `AgentHooks` object that bridges Cline's file-based hook scripts
 * into SDK lifecycle callbacks.
 *
 * Each callback dynamically checks `hooksEnabled` so toggling mid-session
 * takes effect immediately.
 *
 * @param stateManager The StateManager instance for reading hook settings.
 * @param emitHookMessage Optional callback to emit hook_status ClineMessages
 *   to the webview. When provided, hook executions become visible in the chat.
 */
export function buildAgentHooks(stateManager: StateManager, emitHookMessage?: HookMessageEmitter): AgentHooks {
	return {
		// ---------------------------------------------------------------
		// TaskStart → onSessionStart
		// ---------------------------------------------------------------
		async onSessionStart(ctx: AgentHookSessionStartContext): Promise<AgentHookControl | undefined> {
			try {
				const enabled = getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled"))
				if (!enabled) {
					return undefined
				}

				const factory = new HookFactory()
				const hasHook = await factory.hasHook("TaskStart")
				if (!hasHook) {
					return undefined
				}

				emitHookMessage?.(buildHookStatusMessage({ hookName: "TaskStart", status: "running" }))

				const runner = await factory.create("TaskStart")
				const result = await runner.run({
					taskId: ctx.conversationId,
					taskStart: {
						taskMetadata: {
							taskId: ctx.conversationId,
							ulid: "",
							initialTask: "",
						},
					},
				})

				emitHookMessage?.(buildHookStatusMessage({ hookName: "TaskStart", status: "completed" }))
				return mapHookResult(result)
			} catch (error) {
				emitHookMessage?.(buildHookStatusMessage({ hookName: "TaskStart", status: "failed" }))
				Logger.error("[HooksAdapter] onSessionStart hook failed:", error)
				return undefined
			}
		},

		// ---------------------------------------------------------------
		// PreToolUse → onToolCallStart
		// ---------------------------------------------------------------
		async onToolCallStart(ctx: AgentHookToolCallStartContext): Promise<AgentHookControl | undefined> {
			try {
				const enabled = getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled"))
				if (!enabled) {
					return undefined
				}

				const factory = new HookFactory()
				const hasHook = await factory.hasHook("PreToolUse")
				if (!hasHook) {
					return undefined
				}

				const toolName = ctx.call.name
				emitHookMessage?.(buildHookStatusMessage({ hookName: "PreToolUse", toolName, status: "running" }))

				const runner = await factory.create("PreToolUse")
				const result = await runner.run({
					taskId: ctx.conversationId,
					preToolUse: {
						toolName,
						parameters: toStringRecord(ctx.call.input),
					},
				})

				const finalStatus = result.cancel ? "cancelled" : "completed"
				emitHookMessage?.(buildHookStatusMessage({ hookName: "PreToolUse", toolName, status: finalStatus }))
				return mapHookResult(result)
			} catch (error) {
				emitHookMessage?.(buildHookStatusMessage({ hookName: "PreToolUse", toolName: ctx.call.name, status: "failed" }))
				Logger.error("[HooksAdapter] onToolCallStart hook failed:", error)
				return undefined
			}
		},

		// ---------------------------------------------------------------
		// PostToolUse → onToolCallEnd
		// ---------------------------------------------------------------
		async onToolCallEnd(ctx: AgentHookToolCallEndContext): Promise<AgentHookControl | undefined> {
			try {
				const enabled = getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled"))
				if (!enabled) {
					return undefined
				}

				const factory = new HookFactory()
				const hasHook = await factory.hasHook("PostToolUse")
				if (!hasHook) {
					return undefined
				}

				const toolName = ctx.record.name
				emitHookMessage?.(buildHookStatusMessage({ hookName: "PostToolUse", toolName, status: "running" }))

				const runner = await factory.create("PostToolUse")
				const result = await runner.run({
					taskId: ctx.conversationId,
					postToolUse: {
						toolName,
						parameters: toStringRecord(ctx.record.input),
						result: String(ctx.record.output ?? ctx.record.error ?? ""),
						success: !ctx.record.error,
						executionTimeMs: ctx.record.durationMs,
					},
				})

				const finalStatus = result.cancel ? "cancelled" : "completed"
				emitHookMessage?.(buildHookStatusMessage({ hookName: "PostToolUse", toolName, status: finalStatus }))
				return mapHookResult(result)
			} catch (error) {
				emitHookMessage?.(
					buildHookStatusMessage({ hookName: "PostToolUse", toolName: ctx.record.name, status: "failed" }),
				)
				Logger.error("[HooksAdapter] onToolCallEnd hook failed:", error)
				return undefined
			}
		},

		// ---------------------------------------------------------------
		// TaskComplete → onRunEnd (only when finishReason === 'completed')
		// ---------------------------------------------------------------
		async onRunEnd(ctx: AgentHookRunEndContext): Promise<void> {
			try {
				if (ctx.result.finishReason !== "completed") {
					return
				}

				const enabled = getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled"))
				if (!enabled) {
					return
				}

				const factory = new HookFactory()
				const hasHook = await factory.hasHook("TaskComplete")
				if (!hasHook) {
					return
				}

				emitHookMessage?.(buildHookStatusMessage({ hookName: "TaskComplete", status: "running" }))

				const runner = await factory.create("TaskComplete")
				await runner.run({
					taskId: ctx.conversationId,
					taskComplete: {
						taskMetadata: {
							taskId: ctx.conversationId,
							ulid: "",
							initialTask: "",
						},
					},
				})

				emitHookMessage?.(buildHookStatusMessage({ hookName: "TaskComplete", status: "completed" }))
			} catch (error) {
				emitHookMessage?.(buildHookStatusMessage({ hookName: "TaskComplete", status: "failed" }))
				Logger.error("[HooksAdapter] onRunEnd hook failed:", error)
			}
		},
	}
}
