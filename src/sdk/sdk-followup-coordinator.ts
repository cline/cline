import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@shared/ClineAccount"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import type { TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkFollowupCoordinatorOptions {
	stateManager: StateManager
	interactions: SdkInteractionCoordinator
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	sessionConfigBuilder: SdkSessionConfigBuilder
	getTask: () => TaskProxy | undefined
	createTempSessionHost: () => Promise<{ readMessages(id: string): Promise<unknown[]>; dispose(reason: string): Promise<void> }>
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (
		reader: { readMessages(id: string): Promise<unknown[]> },
		taskId: string,
	) => Promise<unknown[] | undefined>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	resolveContextMentions: (text: string) => Promise<string>
	isClineProviderActive: () => boolean
	emitClineAuthError: () => void
	resetMessageTranslator: () => void
	postStateToWebview: () => Promise<void>
}

export class SdkFollowupCoordinator {
	constructor(private readonly options: SdkFollowupCoordinatorOptions) {}

	async askResponse(prompt?: string, images?: string[], files?: string[], askResponse?: ClineAskResponse): Promise<void> {
		if (this.options.interactions.resolvePendingToolApproval(prompt, askResponse)) {
			return
		}

		if (this.options.interactions.resolvePendingAskQuestion(prompt)) {
			return
		}

		const activeSession = this.options.sessions.getActiveSession()
		const task = this.options.getTask()
		if (!activeSession && task) {
			// No active session but task exists — the session was disposed (e.g., after
			// MCP tool reload or mode switch). Resume by creating a new session with
			// the task's history. Note: we intentionally do NOT check isRunning here.
			// After a turn completes the session is still alive (activeSession exists)
			// but isRunning is false — that's the normal between-turns state, not a
			// reason to tear down and recreate the session.
			Logger.log(`[SdkController] askResponse: No active session but task exists (${task.taskId}), resuming...`)
			await this.tryResumeSessionFromTask(task.taskId, prompt, images, files)
			return
		}

		if (!activeSession) {
			Logger.error("[SdkController] askResponse: No active session")
			return
		}

		const { sessionManager, sessionId } = activeSession
		const wasAlreadyRunning = activeSession.isRunning
		const delivery = wasAlreadyRunning ? ("queue" as const) : undefined

		if (wasAlreadyRunning) {
			Logger.log(`[SdkController] Session is running - queuing follow-up message for session: ${sessionId}`)
		}

		this.options.sessions.setRunning(true)

		// Save a checkpoint before the user feedback message so that
		// checkpoint_created appears right before user_feedback in the
		// message array. The UserMessage "edit & restore" UI sends
		// offset: 1 which subtracts from the user_feedback index,
		// expecting to land on the checkpoint_created message.
		this.saveCheckpointOnUserMessage()

		this.emitUserFeedback(sessionId, prompt, images, files)

		if (!wasAlreadyRunning) {
			this.options.resetMessageTranslator()
		}

		const resolvedPrompt = prompt ? await this.options.resolveContextMentions(prompt) : ""
		this.options.sessions.fireAndForgetSend(sessionManager, sessionId, resolvedPrompt, images, files, delivery)
	}

	private async tryResumeSessionFromTask(taskId: string, prompt?: string, images?: string[], files?: string[]): Promise<void> {
		try {
			await this.resumeSessionFromTask(taskId, prompt, images, files)
		} catch (error) {
			Logger.error("[SdkController] Failed to resume session from task:", error)

			const errorMsg = error instanceof Error ? error.message : String(error)
			const isClineAuth =
				this.options.isClineProviderActive() &&
				(errorMsg.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE) ||
					errorMsg.toLowerCase().includes("missing api key") ||
					errorMsg.toLowerCase().includes("unauthorized"))

			if (isClineAuth) {
				this.options.emitClineAuthError()
			} else {
				this.options.messages.emitSessionEvents(
					[
						{
							ts: Date.now(),
							type: "say",
							say: "error",
							text: `Failed to resume task: ${errorMsg}`,
							partial: false,
						},
					],
					{ type: "status", payload: { sessionId: taskId, status: "error" } },
				)
			}
			await this.options.postStateToWebview()
		}
	}

	private async resumeSessionFromTask(taskId: string, prompt?: string, images?: string[], files?: string[]): Promise<void> {
		Logger.log(`[SdkController] Resuming session from task: ${taskId}`)

		const historyItem = this.options.taskHistory.findHistoryItem(taskId)
		const cwd = historyItem?.cwdOnTaskInitialization ?? (await this.options.getWorkspaceRoot())

		const modeValue = this.options.stateManager.getGlobalSettingsKey("mode")
		const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
		const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
		config.sessionId = taskId

		const tempManager = await this.options.createTempSessionHost()
		const initialMessages = await this.options.loadInitialMessages(tempManager, taskId)
		await tempManager.dispose("readMessages")

		Logger.log(`[SdkController] Resuming with ${initialMessages?.length ?? 0} initial messages`)

		const { startResult, sessionManager } = await this.options.sessions.startNewSession({
			config,
			interactive: true,
			...(initialMessages ? { initialMessages: initialMessages as InitialMessages } : {}),
		})

		const task = this.options.getTask()
		if (task && task.taskId !== startResult.sessionId) {
			task.taskId = startResult.sessionId
		}

		this.options.resetMessageTranslator()

		if (historyItem) {
			historyItem.ts = Date.now()
			historyItem.modelId = config.modelId
			await this.options.taskHistory.updateTaskHistory(historyItem)
		}

		if (prompt?.trim()) {
			this.emitUserFeedback(startResult.sessionId, prompt)
		}

		await this.options.postStateToWebview()

		const effectivePrompt =
			prompt?.trim() ||
			(historyItem
				? `[TASK RESUMPTION] This task was interrupted. It may or may not be complete, so please reassess the task context. The conversation history has been preserved. New instructions from the user: ${historyItem.task}`
				: "[TASK RESUMPTION] Please continue where you left off.")

		const resolvedPrompt = await this.options.resolveContextMentions(effectivePrompt)
		this.options.sessions.fireAndForgetSend(sessionManager, startResult.sessionId, resolvedPrompt, images, files)
	}

	/**
	 * Save a checkpoint when the user submits a message.
	 * Emits a checkpoint_created message and commits the workspace state.
	 * Fire-and-forget to avoid blocking the message send.
	 */
	private saveCheckpointOnUserMessage(): void {
		const task = this.options.getTask()
		if (!task?.checkpointManager) return

		// Emit checkpoint_created message
		const checkpointMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "checkpoint_created",
			partial: false,
		}
		this.options.messages.appendMessages([checkpointMessage])

		// Commit checkpoint asynchronously (fire-and-forget)
		task.checkpointManager.saveCheckpoint().catch((err) => {
			Logger.error("[SdkFollowupCoordinator] Failed to save checkpoint:", err)
		})
	}

	private emitUserFeedback(sessionId: string, prompt?: string, images?: string[], files?: string[]): void {
		const hasPrompt = !!prompt?.trim()
		const hasImages = !!images?.length
		const hasFiles = !!files?.length
		if (!hasPrompt && !hasImages && !hasFiles) {
			return
		}

		const userMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "user_feedback",
			text: prompt ?? "",
			images,
			files,
			partial: false,
		}
		this.options.messages.appendAndEmit([userMessage], {
			type: "status",
			payload: { sessionId, status: "running" },
		})
	}
}
