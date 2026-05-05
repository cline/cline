// Bridges Cline's file-based hook scripts into the SDK's runtime hooks.
//
// Runtime hooks use typed in-process lifecycle callbacks:
//   TaskStart        -> beforeRun
//   UserPromptSubmit -> beforeRun with the latest submitted user message
//   PreToolUse       -> beforeTool
//   PostToolUse      -> afterTool
//   TaskComplete     -> afterRun when completed
//   TaskCancel       -> afterRun when aborted
//
// Deferred hooks (NOT wired here): TaskResume, TaskError, SessionShutdown,
// PreCompact, Notification.

import type {
	AgentAfterToolContext,
	AgentBeforeToolContext,
	AgentHooks,
	AgentRunLifecycleContext,
	AgentStopControl,
} from "@clinebot/shared"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { HookFactory } from "@/core/hooks/hook-factory"
import { getHooksEnabledSafe } from "@/core/hooks/hooks-utils"
import type { StateManager } from "@/core/storage/StateManager"

export type HookMessageEmitter = (message: ClineMessage) => void

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

function mapStopControl(hookOutput: { cancel?: boolean; errorMessage?: string }): AgentStopControl | undefined {
	if (!hookOutput.cancel) {
		return undefined
	}
	return {
		stop: true,
		reason: hookOutput.errorMessage || undefined,
	}
}

function taskIdFromSnapshot(snapshot: AgentRunLifecycleContext["snapshot"]): string {
	return snapshot.conversationId ?? snapshot.runId ?? snapshot.agentId
}

function textFromMessageContent(content: readonly { type: string; text?: string }[]): string {
	return content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("")
}

function latestUserPrompt(ctx: AgentRunLifecycleContext): string {
	for (let index = ctx.snapshot.messages.length - 1; index >= 0; index -= 1) {
		const message = ctx.snapshot.messages[index]
		if (message?.role === "user") {
			return textFromMessageContent(message.content)
		}
	}
	return ""
}

function buildHookStatusMessage(opts: {
	hookName: string
	status: "running" | "completed" | "failed" | "cancelled"
	toolName?: string
	ts?: number
}): ClineMessage {
	return {
		ts: opts.ts ?? Date.now(),
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

export function buildAgentHooks(stateManager: StateManager, emitHookMessage?: HookMessageEmitter): AgentHooks {
	const hooksEnabled = () => getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled"))

	return {
		async beforeRun(ctx: AgentRunLifecycleContext): Promise<AgentStopControl | undefined> {
			const taskStartControl = await runTaskStart(ctx, hooksEnabled, emitHookMessage)
			if (taskStartControl) {
				return taskStartControl
			}
			return runUserPromptSubmit(ctx, hooksEnabled, emitHookMessage)
		},

		async beforeTool(ctx: AgentBeforeToolContext): Promise<{ stop?: boolean; reason?: string } | undefined> {
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return undefined
				}

				const factory = new HookFactory()
				if (!(await factory.hasHook("PreToolUse"))) {
					return undefined
				}

				const toolName = ctx.toolCall.toolName
				const runningMsg = buildHookStatusMessage({ hookName: "PreToolUse", toolName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

				const runner = await factory.create("PreToolUse")
				const result = await runner.run({
					taskId: taskIdFromSnapshot(ctx.snapshot),
					preToolUse: {
						toolName,
						parameters: toStringRecord(ctx.input),
					},
				})

				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PreToolUse",
						toolName,
						status: result.cancel ? "cancelled" : "completed",
						ts: runningTs,
					}),
				)
				return mapStopControl(result)
			} catch (error) {
				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PreToolUse",
						toolName: ctx.toolCall.toolName,
						status: "failed",
						ts: runningTs,
					}),
				)
				Logger.error("[HooksAdapter] beforeTool hook failed:", error)
				return undefined
			}
		},

		async afterTool(ctx: AgentAfterToolContext): Promise<undefined> {
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return undefined
				}

				const factory = new HookFactory()
				if (!(await factory.hasHook("PostToolUse"))) {
					return undefined
				}

				const toolName = ctx.toolCall.toolName
				const runningMsg = buildHookStatusMessage({ hookName: "PostToolUse", toolName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

				const runner = await factory.create("PostToolUse")
				const result = await runner.run({
					taskId: taskIdFromSnapshot(ctx.snapshot),
					postToolUse: {
						toolName,
						parameters: toStringRecord(ctx.input),
						result: String(ctx.result.output ?? ""),
						success: !ctx.result.isError,
						executionTimeMs: ctx.durationMs,
					},
				})

				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PostToolUse",
						toolName,
						status: result.cancel ? "cancelled" : "completed",
						ts: runningTs,
					}),
				)
				return undefined
			} catch (error) {
				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PostToolUse",
						toolName: ctx.toolCall.toolName,
						status: "failed",
						ts: runningTs,
					}),
				)
				Logger.error("[HooksAdapter] afterTool hook failed:", error)
				return undefined
			}
		},

		async afterRun(ctx): Promise<void> {
			let hookName: "TaskComplete" | "TaskCancel" | undefined
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return
				}

				hookName =
					ctx.result.status === "completed"
						? "TaskComplete"
						: ctx.result.status === "aborted"
							? "TaskCancel"
							: undefined
				if (!hookName) {
					return
				}

				const factory = new HookFactory()
				if (!(await factory.hasHook(hookName))) {
					return
				}

				const taskId = taskIdFromSnapshot(ctx.snapshot)
				const runningMsg = buildHookStatusMessage({ hookName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

				if (hookName === "TaskComplete") {
					const runner = await factory.create("TaskComplete")
					await runner.run({
						taskId,
						taskComplete: {
							taskMetadata: {
								taskId,
								ulid: "",
								initialTask: "",
								result: ctx.result.outputText,
							},
						},
					})
				} else {
					const runner = await factory.create("TaskCancel")
					await runner.run({
						taskId,
						taskCancel: {
							taskMetadata: {
								taskId,
								ulid: "",
								initialTask: "",
								completionStatus: "cancelled",
							},
						},
					})
				}

				emitHookMessage?.(buildHookStatusMessage({ hookName, status: "completed", ts: runningTs }))
			} catch (error) {
				emitHookMessage?.(
					buildHookStatusMessage({ hookName: hookName ?? "TaskComplete", status: "failed", ts: runningTs }),
				)
				Logger.error("[HooksAdapter] afterRun hook failed:", error)
			}
		},
	}
}

async function runTaskStart(
	ctx: AgentRunLifecycleContext,
	hooksEnabled: () => boolean,
	emitHookMessage?: HookMessageEmitter,
): Promise<AgentStopControl | undefined> {
	let runningTs: number | undefined
	try {
		if (!hooksEnabled()) {
			return undefined
		}

		const factory = new HookFactory()
		if (!(await factory.hasHook("TaskStart"))) {
			return undefined
		}

		const runningMsg = buildHookStatusMessage({ hookName: "TaskStart", status: "running" })
		runningTs = runningMsg.ts
		emitHookMessage?.(runningMsg)

		const taskId = taskIdFromSnapshot(ctx.snapshot)
		const runner = await factory.create("TaskStart")
		const result = await runner.run({
			taskId,
			taskStart: {
				taskMetadata: {
					taskId,
					ulid: "",
					initialTask: latestUserPrompt(ctx),
				},
			},
		})

		emitHookMessage?.(
			buildHookStatusMessage({
				hookName: "TaskStart",
				status: result.cancel ? "cancelled" : "completed",
				ts: runningTs,
			}),
		)
		return mapStopControl(result)
	} catch (error) {
		emitHookMessage?.(buildHookStatusMessage({ hookName: "TaskStart", status: "failed", ts: runningTs }))
		Logger.error("[HooksAdapter] beforeRun (TaskStart) hook failed:", error)
		return undefined
	}
}

async function runUserPromptSubmit(
	ctx: AgentRunLifecycleContext,
	hooksEnabled: () => boolean,
	emitHookMessage?: HookMessageEmitter,
): Promise<AgentStopControl | undefined> {
	let runningTs: number | undefined
	try {
		if (!hooksEnabled()) {
			return undefined
		}

		const factory = new HookFactory()
		if (!(await factory.hasHook("UserPromptSubmit"))) {
			return undefined
		}

		const runningMsg = buildHookStatusMessage({ hookName: "UserPromptSubmit", status: "running" })
		runningTs = runningMsg.ts
		emitHookMessage?.(runningMsg)

		const runner = await factory.create("UserPromptSubmit")
		const result = await runner.run({
			taskId: taskIdFromSnapshot(ctx.snapshot),
			userPromptSubmit: {
				prompt: latestUserPrompt(ctx),
				attachments: [],
			},
		})

		emitHookMessage?.(
			buildHookStatusMessage({
				hookName: "UserPromptSubmit",
				status: result.cancel ? "cancelled" : "completed",
				ts: runningTs,
			}),
		)
		return mapStopControl(result)
	} catch (error) {
		emitHookMessage?.(buildHookStatusMessage({ hookName: "UserPromptSubmit", status: "failed", ts: runningTs }))
		Logger.error("[HooksAdapter] beforeRun (UserPromptSubmit) hook failed:", error)
		return undefined
	}
}
