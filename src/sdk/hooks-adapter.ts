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
import { Logger } from "@shared/services/Logger"
import { HookFactory } from "@/core/hooks/hook-factory"
import { getHooksEnabledSafe } from "@/core/hooks/hooks-utils"
import type { StateManager } from "@/core/storage/StateManager"

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
 * Build an `AgentHooks` object that bridges Cline's file-based hook scripts
 * into SDK lifecycle callbacks.
 *
 * Each callback dynamically checks `hooksEnabled` so toggling mid-session
 * takes effect immediately.
 */
export function buildAgentHooks(stateManager: StateManager): AgentHooks {
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

				return mapHookResult(result)
			} catch (error) {
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
				const runner = await factory.create("PreToolUse")
				const result = await runner.run({
					taskId: ctx.conversationId,
					preToolUse: {
						toolName: ctx.call.name,
						parameters: toStringRecord(ctx.call.input),
					},
				})

				return mapHookResult(result)
			} catch (error) {
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
				const runner = await factory.create("PostToolUse")
				const result = await runner.run({
					taskId: ctx.conversationId,
					postToolUse: {
						toolName: ctx.record.name,
						parameters: toStringRecord(ctx.record.input),
						result: String(ctx.record.output ?? ctx.record.error ?? ""),
						success: !ctx.record.error,
						executionTimeMs: ctx.record.durationMs,
					},
				})

				return mapHookResult(result)
			} catch (error) {
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
			} catch (error) {
				Logger.error("[HooksAdapter] onRunEnd hook failed:", error)
			}
		},
	}
}
