import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@shared/ClineAccount"
import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { historyItemToSessionMetadata, type SdkTaskHistory } from "./sdk-task-history"
import type { SdkSessionHost } from "./session-host"
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
	createTempSessionHost: () => Promise<SdkSessionHost>
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (sessionHost: SdkSessionHost, taskId: string) => Promise<unknown[] | undefined>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	resolveContextMentions: (text: string) => Promise<string>
	isClineManagedProviderActive: () => boolean
	emitClineAuthError: () => void
	resetMessageTranslator: () => void
	postStateToWebview: () => Promise<void>
	/** Resolves once no plan/act mode rebuild is in flight. */
	waitForPendingModeRebuild: () => Promise<void>
	/**
	 * Called when resuming a task fails. askResponse moved the turn phase to
	 * streaming before delegating here, so the failure must move it to a
	 * terminal phase or the footer stays stuck on Thinking/Cancel.
	 */
	onResumeFailed: () => void
}

export class SdkFollowupCoordinator {
	constructor(private readonly options: SdkFollowupCoordinatorOptions) {}

	async askResponse(
		prompt?: string,
		images?: string[],
		files?: string[],
		askResponse?: ClineAskResponse,
		turnPhaseAtSubmit?: TurnPhase,
	): Promise<void> {
		if (this.options.interactions.resolvePendingMistakeLimit(prompt, askResponse)) {
			return
		}

		if (this.options.interactions.resolvePendingToolApproval(prompt, askResponse, images, files)) {
			return
		}

		if (this.options.interactions.resolvePendingAskQuestion(prompt)) {
			return
		}

		let activeSession = this.options.sessions.getActiveSession()
		const task = this.options.getTask()
		const submittedDuringActiveTurn = turnPhaseAtSubmit === "streaming" || turnPhaseAtSubmit === "awaiting_approval"
		const isActiveTurnInProgress = () => !!activeSession && (activeSession.isRunning || submittedDuringActiveTurn)
		if (!isActiveTurnInProgress() && task) {
			// A mode rebuild clears the active session while the old stop is
			// awaited and only marks the replacement running after the
			// continuation send. Resuming in that window would start a parallel
			// session that the rebuild then kills, losing this message. Wait for
			// the rebuild and re-evaluate against the rebuilt session.
			await this.options.waitForPendingModeRebuild()
			activeSession = this.options.sessions.getActiveSession()
		}
		if (!isActiveTurnInProgress() && task) {
			Logger.log(`[SdkController] askResponse: No active session but task exists (${task.taskId}), resuming...`)
			await this.tryResumeSessionFromTask(task.taskId, prompt, images, files)
			return
		}

		if (!activeSession) {
			Logger.error("[SdkController] askResponse: No active session")
			return
		}

		const { sdkHost, sessionId } = activeSession
		const shouldQueue = isActiveTurnInProgress()
		const delivery = shouldQueue ? ("queue" as const) : undefined

		if (shouldQueue) {
			Logger.log(`[SdkController] Session is running - queuing follow-up message for session: ${sessionId}`)
		}

		this.options.sessions.setRunning(true)
		if (!shouldQueue) {
			this.emitUserFeedback(sessionId, prompt, images, files)
		}

		if (!shouldQueue) {
			this.options.resetMessageTranslator()
		}

		const resolvedPrompt = prompt ? await this.options.resolveContextMentions(prompt) : ""
		this.options.sessions.fireAndForgetSend(sdkHost, sessionId, resolvedPrompt, images, files, delivery)
	}

	private async tryResumeSessionFromTask(taskId: string, prompt?: string, images?: string[], files?: string[]): Promise<void> {
		try {
			await this.resumeSessionFromTask(taskId, prompt, images, files)
		} catch (error) {
			Logger.error("[SdkController] Failed to resume session from task:", error)

			const errorMsg = error instanceof Error ? error.message : String(error)
			const isClineAuth =
				this.options.isClineManagedProviderActive() &&
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
			this.options.onResumeFailed()
			await this.options.postStateToWebview()
		}
	}

	private async resumeSessionFromTask(taskId: string, prompt?: string, images?: string[], files?: string[]): Promise<void> {
		Logger.log(`[SdkController] Resuming session from task: ${taskId}`)

		const historyItem = await this.options.taskHistory.findHistoryItem(taskId)
		const cwd = historyItem?.cwdOnTaskInitialization ?? (await this.options.getWorkspaceRoot())

		const modeValue = this.options.stateManager.getGlobalSettingsKey("mode")
		const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
		const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
		config.sessionId = taskId

		const isLegacyTask = await this.options.taskHistory.isLegacyTask(taskId)
		const tempManager = await this.options.createTempSessionHost()
		const persistedInitialMessages = await this.options.loadInitialMessages(tempManager, taskId)
		await tempManager.dispose("readMessages")
		const initialMessages = isLegacyTask
			? await this.options.taskHistory.getLegacyResumeInitialMessages(taskId, persistedInitialMessages)
			: persistedInitialMessages

		Logger.log(`[SdkController] Resuming with ${initialMessages?.length ?? 0} initial messages`)

		const { startResult, sdkHost } = await this.options.sessions.startNewSession({
			config,
			interactive: true,
			...(initialMessages ? { initialMessages: initialMessages as InitialMessages } : {}),
			...(historyItem ? { sessionMetadata: historyItemToSessionMetadata(historyItem, config.modelId) } : {}),
		})

		const task = this.options.getTask()
		if (task && task.taskId !== startResult.sessionId) {
			task.taskId = startResult.sessionId
		}

		this.options.resetMessageTranslator()

		if (historyItem) {
			historyItem.ts = Date.now()
			historyItem.modelId = config.modelId
			await this.options.taskHistory.updateTaskHistoryItem(historyItem)
		}

		// Echo whenever the user supplied content, including attachment-only
		// resumes, and include the attachments in the bubble. This also keeps the
		// visible transcript aligned with SDK history for edit/regenerate ordinal
		// mapping: a resumption prompt carrying user attachments is counted as a
		// visible user message, a bare resumption prompt is not.
		if (prompt?.trim() || images?.length || files?.length) {
			this.emitUserFeedback(startResult.sessionId, prompt, images, files)
		}

		await this.options.postStateToWebview()

		const effectivePrompt =
			prompt?.trim() ||
			(historyItem
				? `[TASK RESUMPTION] This task was interrupted. It may or may not be complete, so please reassess the task context. The conversation history has been preserved. New instructions from the user: ${historyItem.task}`
				: "[TASK RESUMPTION] Please continue where you left off.")

		const resolvedPrompt = await this.options.resolveContextMentions(effectivePrompt)
		this.options.sessions.fireAndForgetSend(sdkHost, startResult.sessionId, resolvedPrompt, images, files)
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
