import type { AgentEvent, CoreSessionEvent } from "@cline/core"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import type { MessageTranslatorState, TranslationResult } from "./message-translator"
import { translateSessionEvent } from "./message-translator"
import { PROVIDER_FAILURE_ERROR_TYPE, PROVIDER_FAILURE_PHASE, type ProviderFailureTelemetry } from "./provider-failure-telemetry"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import type { TaskProxy } from "./task-proxy"

type AgentFailureTelemetry = Pick<ProviderFailureTelemetry, "sessionId" | "error" | "errorType"> | undefined

export interface SdkSessionEventCoordinatorOptions {
	messageTranslatorState: MessageTranslatorState
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	getTask: () => TaskProxy | undefined
	postStateToWebview: () => Promise<void>
	translateSessionEvent?: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult
	/**
	 * Set the authoritative UI turn phase. Called as the agent streams (streaming), on a
	 * completed turn (completed if attempt_completion was used, else awaiting_followup), and on
	 * error. Optional for tests.
	 */
	setTurnPhase?: (phase: TurnPhase, anchorTs?: number) => void
	captureProviderApiError?: (event: ProviderFailureTelemetry) => void
	beginProviderFailureTelemetryTurn?: () => void
}

export class SdkSessionEventCoordinator {
	private readonly translateSessionEvent: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult

	constructor(private readonly options: SdkSessionEventCoordinatorOptions) {
		this.translateSessionEvent = options.translateSessionEvent ?? translateSessionEvent
	}

	async handleSessionEvent(event: CoreSessionEvent): Promise<void> {
		this.logQueueEvents(event)

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession || event.payload.sessionId !== activeSession.sessionId) {
			Logger.debug(
				`[SdkController] Ignoring stale SDK event for session ${event.payload.sessionId}; active=${activeSession?.sessionId ?? "none"}`,
			)
			return
		}

		if (event.type === "pending_prompts") {
			this.options.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post pending-prompt state update:", err)
			})
		}

		const result = this.translateSessionEvent(event, this.options.messageTranslatorState)
		const agentFailure = this.getAgentFailureTelemetry(event)
		if (agentFailure && !this.options.messageTranslatorState.isSuppressedToolApprovalDenial(agentFailure.error)) {
			this.options.captureProviderApiError?.({
				sessionId: agentFailure.sessionId,
				error: agentFailure.error,
				errorType: agentFailure.errorType,
				failurePhase: PROVIDER_FAILURE_PHASE.STREAMING,
			})
		}
		if (event.type === "pending_prompt_submitted") {
			this.options.beginProviderFailureTelemetryTurn?.()
			this.options.messageTranslatorState.clearTurnOutcome()
			this.options.sessions.setRunning(true)
			this.options.setTurnPhase?.(PROVIDER_FAILURE_PHASE.STREAMING)
		}
		if (!activeSession.isRunning && result.messages.length > 0) {
			result.messages = result.messages.filter(
				(m) => !(m.type === "ask" && (m.ask === "completion_result" || m.ask === "resume_completed_task")),
			)
		}

		if (result.messages.length > 0) {
			this.options.messages.appendAndEmit(result.messages, event)
		}

		if (activeSession) {
			if (result.sessionEnded || result.turnComplete) {
				// Authoritative UI phase at turn end. If the completion tool was used this turn
				// the phase is "completed" (green box + Start New Task); otherwise the agent
				// simply stopped and is waiting for the user ("awaiting_followup"). Error turns
				// are surfaced as the error phase. The webview reads this, not the array tail.
				//
				// EXCEPTION: if the session is already not running, this turn-complete is a
				// straggler from a turn that was cancelled (cancelTask already set phase
				// "resumable" and aborted). Overwriting it here would clobber "resumable" with
				// "awaiting_followup"/"completed" and the footer would lose the Resume Task button
				// (showing the scroll-arrow default instead), so the cancel-set phase is preserved.
				if (!activeSession.isRunning) {
					Logger.debug("[SdkController] turn-complete straggler after cancel; preserving resumable phase")
				} else if (this.options.messageTranslatorState.wasAttemptCompletionSeen()) {
					this.options.setTurnPhase?.("completed")
				} else {
					this.options.setTurnPhase?.("awaiting_followup")
				}

				this.options.sessions.setRunning(false)
			}

			if (result.usage && activeSession.startResult) {
				Promise.resolve(
					this.options.taskHistory.updateTaskUsage(
						this.options.getTask()?.taskId ?? this.options.sessions.getActiveSession()?.sessionId,
						result.usage,
					),
				).catch((error) => {
					Logger.error("[SdkController] Failed to persist task usage:", error)
				})
			}
		}

		// Post state when there are messages to ship OR when the turn ended. A clean turn end's
		// `done` event carries no transcript message, yet the authoritative phase just changed to
		// completed/awaiting_followup/error above; without posting here the webview would stay on
		// the prior phase (footer stuck on the streaming/scroll state). The webview reducer gates
		// turnState by seq, so an extra no-message post is safe.
		if (
			result.messages.length > 0 ||
			result.sessionEnded ||
			result.turnComplete ||
			event.type === "pending_prompt_submitted"
		) {
			this.options.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post state after event:", err)
			})
		}
	}

	private getAgentFailureTelemetry(event: CoreSessionEvent): AgentFailureTelemetry {
		if (event.type !== "agent_event") {
			return undefined
		}

		const agentEvent: AgentEvent = event.payload.event
		if (agentEvent.type === "error") {
			if (agentEvent.error == null) {
				return undefined
			}
			return {
				sessionId: event.payload.sessionId,
				error: agentEvent.error,
				errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_ERROR,
			}
		}
		if (agentEvent.type === "done" && agentEvent.reason === "error") {
			const errorMessage = agentEvent.text.trim() || "SDK agent finished with error"
			return {
				sessionId: event.payload.sessionId,
				error: errorMessage,
				errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_DONE_ERROR,
			}
		}
		return undefined
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
