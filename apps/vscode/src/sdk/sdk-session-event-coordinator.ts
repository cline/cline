import type { CoreSessionEvent } from "@bedrock-coder/core"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import type { MessageTranslatorState, TranslationResult } from "./message-translator"
import { translateSessionEvent } from "./message-translator"
import { type AgentRunLifecycle, sanitizeRunFailure } from "./run-lifecycle"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import type { SdkToolResultStore } from "./sdk-tool-result-store"
import type { TaskProxy } from "./task-proxy"

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
	runLifecycle?: AgentRunLifecycle
	toolResults?: SdkToolResultStore
	onQueuedPromptSubmitted?: (sessionId: string) => string
}

export class SdkSessionEventCoordinator {
	private readonly translateSessionEvent: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult
	private readonly pendingStreamMessages = new Map<
		number,
		{ message: import("@shared/ExtensionMessage").BedrockCoderMessage; event: CoreSessionEvent }
	>()
	private streamFlushTimer: ReturnType<typeof setTimeout> | undefined

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

		if (event.type === "pending_prompt_submitted") {
			this.flushStreamMessages()
			this.options.onQueuedPromptSubmitted?.(event.payload.sessionId)
		}

		const runId = this.options.runLifecycle?.currentRunId
		const runState = this.options.runLifecycle?.get()
		if (
			runId &&
			event.type !== "pending_prompts" &&
			event.type !== "pending_prompt_submitted" &&
			(runState?.phase === "cancelling" || runState?.phase === "cancelled")
		) {
			Logger.debug(`[SdkController] Ignoring late event for cancelled run ${runId}: ${event.type}`)
			return
		}

		this.observeRunEvent(event, runId)

		if (event.type === "pending_prompts") {
			this.options.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post pending-prompt state update:", err)
			})
		}

		const result = this.translateSessionEvent(event, this.options.messageTranslatorState)
		if (event.type === "pending_prompt_submitted") {
			this.options.messageTranslatorState.clearTurnOutcome()
			this.options.sessions.setRunning(true)
			this.options.setTurnPhase?.("streaming")
		}
		if (!activeSession.isRunning && result.messages.length > 0) {
			result.messages = result.messages.filter(
				(m) => !(m.type === "ask" && (m.ask === "completion_result" || m.ask === "resume_completed_task")),
			)
		}

		if (result.toolResult && this.options.toolResults) {
			const reference = this.options.toolResults.put({
				sessionId: event.payload.sessionId,
				...result.toolResult,
			})
			const primaryMessage = result.messages.find(
				(message) =>
					message.type === "say" &&
					(message.say === "command" ||
						message.say === "tool" ||
						message.say === "use_mcp_server" ||
						message.say === "browser_action_result"),
			)
			if (primaryMessage) {
				primaryMessage.toolResultId = reference.id
				primaryMessage.toolResultPreview = reference.preview
				primaryMessage.toolResultTruncated = reference.truncated
				primaryMessage.toolResultIsError = reference.isError
			}
		}

		const batchable = this.isBatchableStreamEvent(event, result)
		if (batchable) {
			this.queueStreamMessages(result.messages, event)
		} else {
			this.flushStreamMessages()
			if (result.messages.length > 0) {
				this.options.messages.appendAndEmit(result.messages, event)
				if (runId) this.options.runLifecycle?.firstRendered(runId)
			}
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
			(!batchable && result.messages.length > 0) ||
			result.sessionEnded ||
			result.turnComplete ||
			event.type === "pending_prompt_submitted"
		) {
			this.options.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post state after event:", err)
			})
		}
	}

	dispose(): void {
		if (this.streamFlushTimer) clearTimeout(this.streamFlushTimer)
		this.streamFlushTimer = undefined
		this.flushStreamMessages()
	}

	private observeRunEvent(event: CoreSessionEvent, runId: string | undefined): void {
		if (!runId || !this.options.runLifecycle) return
		if (event.type === "agent_event") {
			const agentEvent = event.payload.event
			this.options.runLifecycle.firstEvent(runId)
			if (agentEvent.type === "content_start" && agentEvent.contentType === "tool") {
				this.options.runLifecycle.runningTool(runId, agentEvent.toolName ?? "unknown")
			} else if (agentEvent.type === "content_end" && agentEvent.contentType === "tool") {
				this.options.runLifecycle.streaming(runId)
			} else if (agentEvent.type === "done") {
				this.options.runLifecycle.complete(runId)
			} else if (agentEvent.type === "error") {
				this.options.runLifecycle.fail(runId, sanitizeRunFailure(agentEvent.error, "stream"))
			}
		} else if (event.type === "ended") {
			this.options.runLifecycle.complete(runId)
		}
	}

	private isBatchableStreamEvent(event: CoreSessionEvent, result: TranslationResult): boolean {
		if (result.messages.length === 0 || event.type !== "agent_event") return false
		const agentEvent = event.payload.event
		return (
			agentEvent.type === "content_start" && (agentEvent.contentType === "text" || agentEvent.contentType === "reasoning")
		)
	}

	private queueStreamMessages(
		messages: import("@shared/ExtensionMessage").BedrockCoderMessage[],
		event: CoreSessionEvent,
	): void {
		for (const message of messages) {
			this.pendingStreamMessages.set(message.ts, { message, event })
		}
		if (!this.streamFlushTimer) {
			this.streamFlushTimer = setTimeout(() => {
				this.streamFlushTimer = undefined
				this.flushStreamMessages()
			}, 32)
		}
	}

	private flushStreamMessages(): void {
		if (this.pendingStreamMessages.size === 0) return
		if (this.streamFlushTimer) clearTimeout(this.streamFlushTimer)
		this.streamFlushTimer = undefined
		const pending = [...this.pendingStreamMessages.values()]
		this.pendingStreamMessages.clear()
		const messages = pending.map(({ message }) => message)
		const event = pending.at(-1)?.event
		if (!event) return
		this.options.messages.appendAndEmit(messages, event)
		const runId = this.options.runLifecycle?.currentRunId
		if (runId) this.options.runLifecycle?.firstRendered(runId)
		this.options.postStateToWebview().catch((error) => {
			Logger.error("[SdkController] Failed to post batched stream state:", error)
		})
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
