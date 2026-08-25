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
} from "@cline/shared"
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

function mapStopControl(hookOutput: {
	cancel?: boolean
	errorMessage?: string
	contextModification?: string
}): AgentStopControl | undefined {
	if (!hookOutput.cancel) {
		return undefined
	}
	// A cancelling hook's contextModification is never injected as context;
	// it serves as the fallback explanation when no errorMessage was given.
	const reason = hookOutput.errorMessage?.trim() || hookOutput.contextModification?.trim() || undefined
	return {
		stop: true,
		reason,
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

export function buildAgentHooks(
	stateManager: StateManager,
	emitHookMessage?: HookMessageEmitter,
	sessionWorkspaceRoot?: string,
): AgentHooks {
	const hooksEnabled = () => getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled"))
	// Session-scoped discovery: the session's root is not always among the
	// window's workspace folders (e.g. the chat-workspace fallback when no
	// folder is open), so the factory also scans this session's own workspace.
	const createFactory = () => new HookFactory({ sessionWorkspaceRoot })

	return {
		async beforeRun(ctx: AgentRunLifecycleContext): Promise<AgentStopControl | undefined> {
			const taskStartControl = await runTaskStart(ctx, hooksEnabled, createFactory, emitHookMessage)
			if (taskStartControl) {
				return taskStartControl
			}
			return runUserPromptSubmit(ctx, hooksEnabled, createFactory, emitHookMessage)
		},

		async beforeTool(
			ctx: AgentBeforeToolContext,
		): Promise<{ stop?: boolean; reason?: string; appendContext?: string } | undefined> {
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return undefined
				}

				const factory = createFactory()
				const runner = await factory.create("PreToolUse")
				if (runner.isNoOp) {
					return undefined
				}

				const toolName = ctx.toolCall.toolName
				const runningMsg = buildHookStatusMessage({ hookName: "PreToolUse", toolName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

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
				const stopControl = mapStopControl(result)
				if (stopControl) {
					return stopControl
				}
				// The runtime injects appendContext into the conversation as a
				// <hook_context> block, restoring the documented contextModification
				// behavior. HookFactory already truncates it at 50KB.
				const contextModification = result.contextModification?.trim()
				return contextModification ? { appendContext: contextModification } : undefined
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

		async afterTool(
			ctx: AgentAfterToolContext,
		): Promise<{ stop?: boolean; reason?: string; appendContext?: string } | undefined> {
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return undefined
				}

				const factory = createFactory()
				const runner = await factory.create("PostToolUse")
				if (runner.isNoOp) {
					return undefined
				}

				const toolName = ctx.toolCall.toolName
				const runningMsg = buildHookStatusMessage({ hookName: "PostToolUse", toolName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

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
				const stopControl = mapStopControl(result)
				if (stopControl) {
					return stopControl
				}
				// The runtime injects appendContext into the conversation as a
				// <hook_context> block, restoring the documented contextModification
				// behavior. HookFactory already truncates it at 50KB.
				const contextModification = result.contextModification?.trim()
				return contextModification ? { appendContext: contextModification } : undefined
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

				const factory = createFactory()
				const runner = await factory.create(hookName)
				if (runner.isNoOp) {
					return
				}

				const taskId = taskIdFromSnapshot(ctx.snapshot)
				const runningMsg = buildHookStatusMessage({ hookName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

				if (hookName === "TaskComplete") {
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
	createFactory: () => HookFactory,
	emitHookMessage?: HookMessageEmitter,
): Promise<AgentStopControl | undefined> {
	let runningTs: number | undefined
	try {
		if (!hooksEnabled()) {
			return undefined
		}

		const factory = createFactory()
		const runner = await factory.create("TaskStart")
		if (runner.isNoOp) {
			return undefined
		}

		const runningMsg = buildHookStatusMessage({ hookName: "TaskStart", status: "running" })
		runningTs = runningMsg.ts
		emitHookMessage?.(runningMsg)

		const taskId = taskIdFromSnapshot(ctx.snapshot)
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
	createFactory: () => HookFactory,
	emitHookMessage?: HookMessageEmitter,
): Promise<AgentStopControl | undefined> {
	let runningTs: number | undefined
	try {
		if (!hooksEnabled()) {
			return undefined
		}

		const factory = createFactory()
		const runner = await factory.create("UserPromptSubmit")
		if (runner.isNoOp) {
			return undefined
		}

		const runningMsg = buildHookStatusMessage({ hookName: "UserPromptSubmit", status: "running" })
		runningTs = runningMsg.ts
		emitHookMessage?.(runningMsg)

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
