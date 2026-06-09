import type { CoreSessionEvent } from "@cline/core"
import { refreshClineRecommendedModels } from "@/core/controller/models/refreshClineRecommendedModels"
import type { StateManager } from "@/core/storage/StateManager"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@/shared/cline/recommended-models"
import type { ClineApiReqInfo, ClineMessage, TurnPhase } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import type { MessageTranslatorState, TranslationResult } from "./message-translator"
import { translateSessionEvent } from "./message-translator"
import type { SdkMcpCoordinator } from "./sdk-mcp-coordinator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkModeCoordinator } from "./sdk-mode-coordinator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import type { TaskProxy } from "./task-proxy"

function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase()
}

export interface SdkSessionEventCoordinatorOptions {
	messageTranslatorState: MessageTranslatorState
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	mcpTools: SdkMcpCoordinator
	mode: SdkModeCoordinator
	taskHistory: SdkTaskHistory
	getTask: () => TaskProxy | undefined
	postStateToWebview: () => Promise<void>
	stateManager?: StateManager
	translateSessionEvent?: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult
	isClineFreeModel?: () => Promise<boolean>
	/**
	 * Set the authoritative UI turn phase. Called as the agent streams (streaming), on a
	 * completed turn (completed if attempt_completion was used, else awaiting_followup), and on
	 * error. Optional for tests.
	 */
	setTurnPhase?: (phase: TurnPhase, anchorTs?: number) => void
}

export class SdkSessionEventCoordinator {
	private readonly translateSessionEvent: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult

	/** Tracks consecutive tool errors for mistake_limit_reached detection */
	private consecutiveToolErrorCount = 0

	constructor(private readonly options: SdkSessionEventCoordinatorOptions) {
		this.translateSessionEvent = options.translateSessionEvent ?? translateSessionEvent
	}

	/** Reset the consecutive tool error counter (e.g. when a new task starts or user responds) */
	resetConsecutiveToolErrorCount(): void {
		this.consecutiveToolErrorCount = 0
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

		const result = this.translateSessionEvent(event, this.options.messageTranslatorState)
		const zeroCostPromise = this.zeroCostForFreeClineModel(result)
		if (zeroCostPromise) {
			await zeroCostPromise
		}

		if (!activeSession.isRunning && result.messages.length > 0) {
			result.messages = result.messages.filter(
				(m) => !(m.type === "ask" && (m.ask === "completion_result" || m.ask === "resume_completed_task")),
			)
		}

		// Track consecutive tool errors and emit mistake_limit_reached once the
		// count reaches the user's maxConsecutiveMistakes setting.
		this.trackToolErrors(result)

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
				} else if (result.toolError && this.consecutiveToolErrorCount === 0) {
					// mistake_limit just fired (counter reset in trackToolErrors) — error UI.
					this.options.setTurnPhase?.("error")
				} else if (this.options.messageTranslatorState.wasAttemptCompletionSeen()) {
					this.options.setTurnPhase?.("completed")
				} else {
					this.options.setTurnPhase?.("awaiting_followup")
				}

				this.options.sessions.setRunning(false)
				this.options.mcpTools.checkDeferredRestart()

				if (this.options.mode.hasPendingModeChange()) {
					this.options.mode.applyPendingModeChange().catch((err) => {
						Logger.error("[SdkController] applyPendingModeChange failed:", err)
					})
				}
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
		if (result.messages.length > 0 || result.sessionEnded || result.turnComplete) {
			this.options.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post state after event:", err)
			})
		}
	}

	/**
	 * Track consecutive tool errors. When the count reaches maxConsecutiveMistakes,
	 * append an ask="mistake_limit_reached" message so the webview shows
	 * "Proceed Anyways" / "Start New Task" buttons instead of tool approval buttons.
	 */
	private trackToolErrors(result: TranslationResult): void {
		if (result.toolSuccess) {
			// A tool succeeded — reset the consecutive error counter
			this.consecutiveToolErrorCount = 0
		}

		if (result.toolError) {
			this.consecutiveToolErrorCount++

			const stateManager = this.options.stateManager
			const maxConsecutiveMistakes = stateManager ? stateManager.getGlobalSettingsKey("maxConsecutiveMistakes") : 3 // default fallback

			if (this.consecutiveToolErrorCount >= maxConsecutiveMistakes) {
				Logger.log(
					`[SdkController] Consecutive tool error count (${this.consecutiveToolErrorCount}) reached limit (${maxConsecutiveMistakes}), emitting mistake_limit_reached`,
				)

				// Model-specific guidance message shown alongside the limit notice.
				const modelId = this.getCurrentClineModelId() ?? ""
				const guidanceMessage = modelId.includes("claude")
					? `This may indicate a failure in Cline's thought process or inability to use a tool properly, which can be mitigated with some user guidance (e.g. "Try breaking down the task into smaller steps").`
					: "Cline uses complex prompts and iterative task execution that may be challenging for less capable models. For best results, it's recommended to use newer, more capable models. If you continue to experience issues, try providing additional guidance or switch to a different model."

				// Emit ask="mistake_limit_reached" message so the webview updates buttons
				const mistakeLimitMessage: ClineMessage = {
					ts: this.options.messageTranslatorState.nextTs(),
					type: "ask",
					ask: "mistake_limit_reached",
					text: guidanceMessage,
					partial: false,
				}

				result.messages.push(mistakeLimitMessage)

				// Mark the turn complete so handleSessionEvent stops the session and
				// the agent waits for user input. Otherwise it keeps running and
				// appends more messages, pushing mistake_limit_reached out of the
				// last-message slot so the webview never shows the correct buttons.
				result.turnComplete = true

				// Abort the SDK session so the agent actually stops producing events.
				// Without this, the SDK's internal loop continues making API calls and
				// tool calls, flooding the message list past our mistake_limit_reached
				// ask message.
				const activeSession = this.options.sessions.getActiveSession()
				if (activeSession) {
					const { sdkHost, sessionId } = activeSession
					sdkHost.abort(sessionId).catch((err) => {
						// AbortError is expected — the session was intentionally stopped
						if (
							err instanceof Error &&
							(err.name === "AbortError" || err.message.toLowerCase().includes("aborted"))
						) {
							Logger.debug(`[SdkController] Session abort after mistake_limit_reached (expected): ${sessionId}`)
						} else {
							Logger.error("[SdkController] Failed to abort session after mistake_limit_reached:", err)
						}
					})
				}

				// Reset the counter after emitting so it can trigger again if the user continues
				this.consecutiveToolErrorCount = 0
			}
		}
	}

	private zeroCostForFreeClineModel(result: TranslationResult): Promise<void> | undefined {
		const hasUsageCost = typeof result.usage?.totalCost === "number" && result.usage.totalCost !== 0
		const hasMessageCost = result.messages.some((message) => {
			if (message.type !== "say" || message.say !== "api_req_started" || !message.text) {
				return false
			}
			try {
				const info = JSON.parse(message.text) as ClineApiReqInfo
				return typeof info.cost === "number" && info.cost !== 0
			} catch {
				return false
			}
		})

		if (!hasUsageCost && !hasMessageCost) {
			return undefined
		}

		return (async () => {
			if (!(await this.isCurrentClineModelFree())) {
				return
			}

			if (result.usage) {
				result.usage = { ...result.usage, totalCost: 0 }
			}

			result.messages = result.messages.map((message) => {
				if (message.type !== "say" || message.say !== "api_req_started" || !message.text) {
					return message
				}
				try {
					const info = JSON.parse(message.text) as ClineApiReqInfo
					if (typeof info.cost !== "number") {
						return message
					}
					return {
						...message,
						text: JSON.stringify({ ...info, cost: 0 } satisfies ClineApiReqInfo),
					}
				} catch {
					return message
				}
			})
		})()
	}

	private async isCurrentClineModelFree(): Promise<boolean> {
		if (this.options.isClineFreeModel) {
			return this.options.isClineFreeModel()
		}

		const stateManager = this.options.stateManager
		if (!stateManager) {
			return false
		}

		try {
			const apiConfig = stateManager.getApiConfiguration()
			const mode = stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
			const provider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
			if (provider !== "cline") {
				return false
			}

			const modelId = mode === "plan" ? apiConfig.planModeClineModelId : apiConfig.actModeClineModelId
			if (!modelId) {
				return false
			}

			const normalizedModelId = normalizeModelId(modelId)
			const models = await refreshClineRecommendedModels()
			const freeIds = models.free.map((model) => normalizeModelId(model.id)).filter(Boolean)
			const resolvedFreeIds =
				freeIds.length > 0 ? freeIds : CLINE_RECOMMENDED_MODELS_FALLBACK.free.map((model) => normalizeModelId(model.id))
			return resolvedFreeIds.includes(normalizedModelId)
		} catch (error) {
			Logger.error("[SdkController] Failed to check Cline free model list:", error)
			const modelId = this.getCurrentClineModelId()
			if (!modelId) {
				return false
			}
			const fallbackFreeIds = CLINE_RECOMMENDED_MODELS_FALLBACK.free.map((model) => normalizeModelId(model.id))
			return fallbackFreeIds.includes(normalizeModelId(modelId))
		}
	}

	private getCurrentClineModelId(): string | undefined {
		const stateManager = this.options.stateManager
		if (!stateManager) {
			return undefined
		}
		const apiConfig = stateManager.getApiConfiguration()
		const mode = stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
		return mode === "plan" ? apiConfig.planModeClineModelId : apiConfig.actModeClineModelId
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
