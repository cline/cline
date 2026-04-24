import type { CoreSessionEvent } from "@clinebot/core"
import { Logger } from "@/shared/services/Logger"
import type { MessageTranslatorState, TranslationResult } from "./message-translator"
import { translateSessionEvent } from "./message-translator"
import type { SdkMcpCoordinator } from "./sdk-mcp-coordinator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkModeCoordinator } from "./sdk-mode-coordinator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import type { TaskProxy } from "./task-proxy"

export interface SdkSessionEventCoordinatorOptions {
	messageTranslatorState: MessageTranslatorState
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	mcpTools: SdkMcpCoordinator
	mode: SdkModeCoordinator
	taskHistory: SdkTaskHistory
	getTask: () => TaskProxy | undefined
	postStateToWebview: () => Promise<void>
	translateSessionEvent?: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult
}

export class SdkSessionEventCoordinator {
	private readonly translateSessionEvent: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult

	constructor(private readonly options: SdkSessionEventCoordinatorOptions) {
		this.translateSessionEvent = options.translateSessionEvent ?? translateSessionEvent
	}

	handleSessionEvent(event: CoreSessionEvent): void {
		this.logQueueEvents(event)

		const result = this.translateSessionEvent(event, this.options.messageTranslatorState)
		const activeSession = this.options.sessions.getActiveSession()

		if (activeSession && !activeSession.isRunning && result.messages.length > 0) {
			result.messages = result.messages.filter(
				(m) => !(m.type === "ask" && (m.ask === "completion_result" || m.ask === "resume_completed_task")),
			)
		}

		if (result.messages.length > 0) {
			this.options.messages.appendAndEmit(result.messages, event)
		}

		if (activeSession) {
			if (result.sessionEnded || result.turnComplete) {
				this.options.sessions.setRunning(false)
				this.options.mcpTools.checkDeferredRestart()

				if (this.options.mode.hasPendingModeChange()) {
					this.options.mode.applyPendingModeChange().catch((err) => {
						Logger.error("[SdkController] applyPendingModeChange failed:", err)
					})
				}
			}

			if (result.usage && activeSession.startResult) {
				this.options.taskHistory.updateTaskUsage(
					this.options.getTask()?.taskId ?? this.options.sessions.getActiveSession()?.sessionId,
					result.usage,
				)
			}
		}

		if (result.messages.length > 0) {
			this.options.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post state after event:", err)
			})
		}
	}

	private logQueueEvents(event: CoreSessionEvent): void {
		if (event.type === "pending_prompts") {
			const count = event.payload.prompts.length
			Logger.log(
				`[SdkController] Pending prompts updated: ${count} prompt(s) in queue for session ${event.payload.sessionId}`,
			)
			return
		}

		if (event.type === "pending_prompt_submitted") {
			Logger.log(
				`[SdkController] Pending prompt submitted: "${event.payload.prompt.substring(0, 80)}" for session ${event.payload.sessionId}`,
			)
		}
	}
}
