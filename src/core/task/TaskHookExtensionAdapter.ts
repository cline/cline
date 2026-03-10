import type { AgentHooks } from "@cline/agents"
import { executeHook } from "@core/hooks/hook-executor"
import type { Hooks as HookInputs } from "@core/hooks/hook-factory"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { executePreCompactHookWithCleanup, type HookExecution } from "@core/hooks/precompact-executor"
import type { ClineMessage, ClineSay } from "@shared/ExtensionMessage"
import type { ClineContent, ClineStorageMessage } from "@shared/messages/content"
import type { ContextManager } from "@/core/context/context-management/ContextManager"
import type { MessageStateHandler } from "@/core/task/message-state"
import { Logger } from "@/shared/services/Logger"

type WithStateLock = <T>(fn: () => T | Promise<T>) => Promise<T>

export interface TaskHookResult {
	cancel?: boolean
	contextModification?: string
	errorMessage?: string
	wasCancelled: boolean
}

export interface TaskHookAdapterContext {
	taskId: string
	ulid: string
	taskState: {
		abort: boolean
		didFinishAbortingStream: boolean
		activeHookExecution?: HookExecution
	}
	messageStateHandler: MessageStateHandler
	say: (type: ClineSay, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>
	postStateToWebview: () => Promise<void>
	cancelTask: () => Promise<void>
	withStateLock?: WithStateLock
}

export interface CreateTaskAgentHooksOptions {
	onRunStart: () => Promise<{ cancel?: boolean; context?: string } | undefined>
	buildPendingToolInfo: (toolName: string, toolInput: unknown) => Record<string, unknown> | undefined
	toHookStringParameters: (input: unknown) => Record<string, string>
	createHookContextBlock: (hookName: string, contextModification?: string) => string | undefined
	safeJsonStringify: (value: unknown) => string
}

/**
 * Adapter that ports task-coupled hook behavior to the agents-extension boundary.
 * This keeps hook semantics in one place while task/runtime migration completes.
 */
export class TaskHookExtensionAdapter {
	constructor(private readonly ctx: TaskHookAdapterContext) {}

	async setActiveHookExecution(hookExecution: HookExecution): Promise<void> {
		if (this.ctx.withStateLock) {
			await this.ctx.withStateLock(() => {
				this.ctx.taskState.activeHookExecution = hookExecution
			})
			return
		}
		this.ctx.taskState.activeHookExecution = hookExecution
	}

	async clearActiveHookExecution(): Promise<void> {
		if (this.ctx.withStateLock) {
			await this.ctx.withStateLock(() => {
				this.ctx.taskState.activeHookExecution = undefined
			})
			return
		}
		this.ctx.taskState.activeHookExecution = undefined
	}

	async getActiveHookExecution(): Promise<HookExecution | undefined> {
		if (this.ctx.withStateLock) {
			return await this.ctx.withStateLock(() => this.ctx.taskState.activeHookExecution)
		}
		return this.ctx.taskState.activeHookExecution
	}

	async runTaskLifecycleHook<K extends "TaskStart" | "TaskResume">(params: {
		hookName: K
		hookInput: HookInputs[K]
	}): Promise<TaskHookResult> {
		const hooksEnabled = getHooksEnabledSafe()
		if (!hooksEnabled) {
			return { wasCancelled: false }
		}

		const result = await executeHook({
			hookName: params.hookName,
			hookInput: params.hookInput,
			isCancellable: true,
			say: this.ctx.say,
			setActiveHookExecution: async (execution) => this.setActiveHookExecution(execution as HookExecution),
			clearActiveHookExecution: async () => this.clearActiveHookExecution(),
			messageStateHandler: this.ctx.messageStateHandler,
			taskId: this.ctx.taskId,
			hooksEnabled,
		})

		return {
			cancel: result.cancel,
			contextModification: result.contextModification,
			errorMessage: result.errorMessage,
			wasCancelled: result.wasCancelled,
		}
	}

	async runUserPromptSubmitHook(userContent: ClineContent[]): Promise<TaskHookResult> {
		const hooksEnabled = getHooksEnabledSafe()
		if (!hooksEnabled) {
			return { wasCancelled: false }
		}

		const { extractUserPromptFromContent } = await import("@/core/task/utils/extractUserPromptFromContent")
		const promptText = extractUserPromptFromContent(userContent)

		const result = await executeHook({
			hookName: "UserPromptSubmit",
			hookInput: {
				userPromptSubmit: {
					prompt: promptText,
					attachments: [],
				},
			},
			isCancellable: true,
			say: this.ctx.say,
			setActiveHookExecution: async (execution) => this.setActiveHookExecution(execution as HookExecution),
			clearActiveHookExecution: async () => this.clearActiveHookExecution(),
			messageStateHandler: this.ctx.messageStateHandler,
			taskId: this.ctx.taskId,
			hooksEnabled,
		})

		if (result.cancel === true && result.wasCancelled) {
			this.ctx.taskState.didFinishAbortingStream = true
			await this.ctx.messageStateHandler.saveClineMessagesAndUpdateHistory()
			await this.ctx.messageStateHandler.overwriteApiConversationHistory(
				this.ctx.messageStateHandler.getApiConversationHistory(),
			)
			await this.ctx.postStateToWebview()
		}

		return {
			cancel: result.cancel,
			contextModification: result.contextModification,
			errorMessage: result.errorMessage,
			wasCancelled: result.wasCancelled,
		}
	}

	async runTaskCancelHook(taskMetadata: { taskId: string; ulid: string; completionStatus: string }): Promise<void> {
		const hooksEnabled = getHooksEnabledSafe()
		if (!hooksEnabled) {
			return
		}

		await executeHook({
			hookName: "TaskCancel",
			hookInput: {
				taskCancel: {
					taskMetadata,
				},
			},
			isCancellable: false,
			say: this.ctx.say,
			messageStateHandler: this.ctx.messageStateHandler,
			taskId: this.ctx.taskId,
			hooksEnabled,
		})
	}

	async runPreCompactHookWithCleanup(params: {
		apiConversationHistory: ClineStorageMessage[]
		conversationHistoryDeletedRange: [number, number] | undefined
		contextManager: ContextManager
		clineMessages: ClineMessage[]
		deletedRange?: [number, number]
	}): Promise<{ contextModification?: string }> {
		const hooksEnabled = getHooksEnabledSafe()
		if (!hooksEnabled) {
			return {}
		}

		return await executePreCompactHookWithCleanup({
			taskId: this.ctx.taskId,
			ulid: this.ctx.ulid,
			apiConversationHistory: params.apiConversationHistory,
			conversationHistoryDeletedRange: params.conversationHistoryDeletedRange,
			contextManager: params.contextManager,
			clineMessages: params.clineMessages,
			messageStateHandler: this.ctx.messageStateHandler,
			compactionStrategy: "standard-truncation-lastquarter",
			deletedRange: params.deletedRange,
			say: this.ctx.say,
			setActiveHookExecution: async (hookExecution: HookExecution | undefined) => {
				if (hookExecution) {
					await this.setActiveHookExecution(hookExecution)
				}
			},
			clearActiveHookExecution: async () => this.clearActiveHookExecution(),
			postStateToWebview: this.ctx.postStateToWebview,
			taskState: this.ctx.taskState,
			cancelTask: this.ctx.cancelTask,
			hooksEnabled,
		})
	}

	async cancelHookExecution(logError: (message: string, error: unknown) => void): Promise<boolean> {
		const activeHook = await this.getActiveHookExecution()
		if (!activeHook) {
			return false
		}

		const { hookName, toolName, messageTs, abortController } = activeHook
		try {
			abortController.abort()

			const clineMessages = this.ctx.messageStateHandler.getClineMessages()
			const hookMessageIndex = clineMessages.findIndex((m) => m.ts === messageTs)
			if (hookMessageIndex !== -1) {
				await this.ctx.messageStateHandler.updateClineMessage(hookMessageIndex, {
					text: JSON.stringify({
						hookName,
						toolName,
						status: "cancelled",
						exitCode: 130,
					}),
				})
			}

			await this.ctx.say("hook_output_stream", "\nHook execution cancelled by user")
			return true
		} catch (error) {
			logError("Failed to cancel hook execution", error)
			return false
		}
	}

	async handleHookCancellation(hookName: string, wasCancelled: boolean): Promise<void> {
		this.ctx.taskState.didFinishAbortingStream = true
		await this.ctx.messageStateHandler.saveClineMessagesAndUpdateHistory()
		await this.ctx.messageStateHandler.overwriteApiConversationHistory(
			this.ctx.messageStateHandler.getApiConversationHistory(),
		)
		await this.ctx.postStateToWebview()
		Logger.log(`[Task ${this.ctx.taskId}] ${hookName} hook cancelled (userInitiated: ${wasCancelled})`)
	}

	createAgentHooks(options: CreateTaskAgentHooksOptions): AgentHooks {
		return {
			onRunStart: async () => options.onRunStart(),
			onToolCallStart: async (ctx) => {
				if (this.ctx.taskState.abort) {
					return { cancel: true }
				}

				const hooksEnabled = getHooksEnabledSafe()
				if (!hooksEnabled) {
					return
				}

				const pendingToolInfo = options.buildPendingToolInfo(ctx.call.name, ctx.call.input)
				const result = await executeHook({
					hookName: "PreToolUse",
					hookInput: {
						preToolUse: {
							toolName: ctx.call.name,
							parameters: options.toHookStringParameters(ctx.call.input),
						},
					},
					isCancellable: true,
					say: this.ctx.say,
					setActiveHookExecution: async (execution) => this.setActiveHookExecution(execution as HookExecution),
					clearActiveHookExecution: async () => this.clearActiveHookExecution(),
					messageStateHandler: this.ctx.messageStateHandler,
					taskId: this.ctx.taskId,
					hooksEnabled,
					toolName: ctx.call.name,
					pendingToolInfo,
				})

				if (result.cancel) {
					await this.clearActiveHookExecution()
					if (result.errorMessage) {
						await this.ctx.say("error", result.errorMessage)
					}
					await this.ctx.cancelTask()
					return { cancel: true }
				}

				const context = options.createHookContextBlock("PreToolUse", result.contextModification)
				return context ? { context } : undefined
			},
			onToolCallEnd: async (ctx) => {
				if (this.ctx.taskState.abort) {
					return { cancel: true }
				}

				const hooksEnabled = getHooksEnabledSafe()
				if (!hooksEnabled) {
					return
				}

				const toolResult = ctx.record.error
					? { error: ctx.record.error }
					: typeof ctx.record.output === "string"
						? ctx.record.output
						: options.safeJsonStringify(ctx.record.output)
				const result = await executeHook({
					hookName: "PostToolUse",
					hookInput: {
						postToolUse: {
							toolName: ctx.record.name,
							parameters: options.toHookStringParameters(ctx.record.input),
							result: typeof toolResult === "string" ? toolResult : options.safeJsonStringify(toolResult),
							success: !ctx.record.error,
							executionTimeMs: ctx.record.durationMs,
						},
					},
					isCancellable: true,
					say: this.ctx.say,
					setActiveHookExecution: async (execution) => this.setActiveHookExecution(execution as HookExecution),
					clearActiveHookExecution: async () => this.clearActiveHookExecution(),
					messageStateHandler: this.ctx.messageStateHandler,
					taskId: this.ctx.taskId,
					hooksEnabled,
					toolName: ctx.record.name,
				})

				if (result.cancel) {
					if (result.errorMessage) {
						await this.ctx.say("error", result.errorMessage)
					}
					await this.ctx.cancelTask()
					return { cancel: true }
				}

				const context = options.createHookContextBlock("PostToolUse", result.contextModification)
				return context ? { context } : undefined
			},
		}
	}
}
