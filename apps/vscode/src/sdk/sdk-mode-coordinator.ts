import { getProviderAuthStorageId } from "@cline/core"
import { createModeSwitchNoticeTracker, type ModeSwitchNotice, type ModeSwitchNoticeTracker } from "@cline/shared"
import type { ChatContent } from "@shared/ChatContent"
import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import { isAbortError, type SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionHost } from "./session-host"
import type { TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

function usesClineAccountAuth(providerId: string): boolean {
	return getProviderAuthStorageId(providerId) === "cline"
}

export const ACT_MODE_CONTINUATION_PROMPT = "The user approved switching to act mode. Continue with the approved plan now."

export interface SdkModeCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	interactions: SdkInteractionCoordinator
	messages: SdkMessageCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	getTask: () => TaskProxy | undefined
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (sdkHost: SdkSessionHost, sessionId: string) => Promise<unknown[]>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	emitClineAuthError: () => void
	resetMessageTranslator: () => void
	postStateToWebview: () => Promise<void>
	/** Authoritative phase of the current turn, from the controller's TurnStateTracker. */
	getTurnPhase: () => TurnPhase
	resolveContextMentions: (text: string) => Promise<string>
	/**
	 * Called right before an auto-continue send kicks off a new turn. Mirrors
	 * initTask/askResponse: moves the turn phase to "streaming" (footer shows
	 * Thinking + Cancel instead of the stale awaiting_followup state) and clears
	 * the previous turn's completion signal.
	 */
	onAutoContinueStarting: () => void
	/**
	 * Called when the rebuild throws after onAutoContinueStarting already flipped
	 * the phase to "streaming" (e.g. resolveContextMentions failed). Moves the
	 * phase to "error" so the footer matches the error message that was emitted,
	 * instead of showing a phantom run.
	 */
	onAutoContinueFailed: () => void
}

export class SdkModeCoordinator {
	private pendingModeChange: Mode | null = null
	private rebuildInFlight: Promise<void> | undefined
	/**
	 * Pending user-initiated mode switch, stamped as a <mode_notice> onto the
	 * next outbound message by SdkSessionLifecycle.fireAndForgetSend. Shares the
	 * CLI's round-trip-cancelling tracker (@cline/shared), scoped to the session
	 * it was recorded for: unlike the CLI, the extension hops between tasks, and
	 * a notice recorded while looking at task A must not leak onto a message
	 * sent to task B (whose transcript never saw the "from" mode).
	 */
	private modeSwitchNoticeTracker: ModeSwitchNoticeTracker = createModeSwitchNoticeTracker()
	private modeSwitchNoticeSessionId: string | null = null

	constructor(private readonly options: SdkModeCoordinatorOptions) {}

	/**
	 * Returns (and clears) the pending mode-switch notice when the outbound
	 * message targets the session the switch was recorded for; otherwise leaves
	 * it pending — mode is a global setting, so the notice stays valid for the
	 * recorded session even if the user visits another task in between.
	 */
	consumeModeSwitchNotice(sessionId: string): ModeSwitchNotice | null {
		if (this.modeSwitchNoticeSessionId !== sessionId) {
			return null
		}
		const notice = this.modeSwitchNoticeTracker.consume()
		if (notice) {
			this.modeSwitchNoticeSessionId = null
		}
		return notice
	}

	private recordModeSwitchNotice(sessionId: string, from: Mode | undefined, to: Mode): void {
		if (from !== "plan" && from !== "act") {
			return
		}
		if (this.modeSwitchNoticeSessionId !== sessionId) {
			// A stale notice for another session is superseded rather than merged:
			// round-trip cancellation only makes sense within one transcript.
			this.modeSwitchNoticeTracker = createModeSwitchNoticeTracker()
		}
		this.modeSwitchNoticeSessionId = sessionId
		this.modeSwitchNoticeTracker.record(from, to)
	}

	/**
	 * Resolves once no mode rebuild is in flight. While a rebuild runs, the
	 * active session is torn down and replaced (and only marked running after
	 * the continuation send), so concurrent message paths must wait on this
	 * instead of treating the gap as "no session" and resuming a parallel
	 * session that the rebuild would then kill.
	 */
	async waitForPendingRebuild(): Promise<void> {
		while (this.rebuildInFlight) {
			const current = this.rebuildInFlight
			await current
			if (this.rebuildInFlight === current) {
				this.rebuildInFlight = undefined
			}
		}
	}

	queueSwitchToActMode(): void {
		this.pendingModeChange = "act"
	}

	hasPendingModeChange(): boolean {
		return this.pendingModeChange !== null
	}

	async applyPendingModeChange(): Promise<void> {
		const target = this.pendingModeChange
		if (!target) {
			return
		}
		this.pendingModeChange = null
		Logger.log(`[SdkController] applyPendingModeChange: switching to ${target}`)
		// The tool result told the model to proceed with the plan, so rebuild with
		// act-mode tools and auto-continue rather than waiting for another user message.
		await this.rebuildSessionForMode(target, { autoContinue: target === "act", source: "tool" })
	}

	async toggleActModeForYoloMode(): Promise<boolean> {
		const currentMode = this.options.stateManager.getGlobalSettingsKey("mode")
		if (currentMode === "act") {
			return false
		}
		await this.options.stateManager.setGlobalState("mode", "act")
		await this.options.postStateToWebview()
		return true
	}

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		const currentMode = this.options.stateManager.getGlobalSettingsKey("mode")
		if (currentMode === modeToSwitchTo) {
			return false
		}

		const activeSession = this.options.sessions.getActiveSession()
		if (activeSession) {
			// A plan -> act toggle while the agent is idle after presenting its plan
			// (awaiting_followup) is the user acting on that plan, so continue
			// automatically. Any other state only updates the session configuration
			// and waits for an explicit send. A pending ask_question also reports
			// awaiting_followup but blocks the turn mid-run, so isRunning stays
			// true and it cannot reach this branch.
			const planPresented = !activeSession.isRunning && this.options.getTurnPhase() === "awaiting_followup"
			const autoContinue = modeToSwitchTo === "act" && planPresented
			const userPrompt = chatContent?.message?.trim() || undefined
			const userImages = chatContent?.images?.length ? chatContent.images : undefined
			const userFiles = chatContent?.files?.length ? chatContent.files : undefined
			const hasUserContent = !!(userPrompt || userImages || userFiles)
			const continuationSent = await this.rebuildSessionForMode(modeToSwitchTo, {
				autoContinue,
				userContinuationPrompt: autoContinue ? userPrompt : undefined,
				userImages: autoContinue ? userImages : undefined,
				userFiles: autoContinue ? userFiles : undefined,
				source: "ui",
			})
			// True tells the webview the composer content was consumed, so it clears it.
			return continuationSent && hasUserContent
		}

		this.options.stateManager.setGlobalState("mode", modeToSwitchTo)
		await this.options.postStateToWebview()
		return false
	}

	/**
	 * Returns true only when the auto-continue send was actually handed to the
	 * session, so callers can tell consumed user content apart from rebuilds
	 * that bailed early (auth error, disposed session, thrown rebuild).
	 */
	async rebuildSessionForMode(
		newMode: Mode,
		options: {
			autoContinue?: boolean
			userContinuationPrompt?: string
			userImages?: string[]
			userFiles?: string[]
			/**
			 * Who initiated the switch. Only "ui" toggles record a <mode_notice>
			 * for the next outbound message; the model-initiated
			 * switch_to_act_mode path ("tool") already announces itself via the
			 * tool result and continuation prompt, matching the CLI's semantics.
			 */
			source?: "ui" | "tool"
		} = {},
	): Promise<boolean> {
		const operation = this.performRebuildSessionForMode(newMode, options)
		// Expose the full rebuild (teardown, replacement, continuation send) to
		// waitForPendingRebuild. Errors are handled inside; the barrier only
		// tracks completion.
		this.rebuildInFlight = operation.then(
			() => undefined,
			() => undefined,
		)
		return operation
	}

	private async performRebuildSessionForMode(
		newMode: Mode,
		options: {
			autoContinue?: boolean
			userContinuationPrompt?: string
			userImages?: string[]
			userFiles?: string[]
			source?: "ui" | "tool"
		},
	): Promise<boolean> {
		const previousMode = this.options.stateManager.getGlobalSettingsKey("mode")
		this.options.stateManager.setGlobalState("mode", newMode)

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			await this.options.postStateToWebview()
			return false
		}

		const { sdkHost: oldManager, sessionId: oldSessionId } = activeSession
		const wasRunning = activeSession.isRunning

		Logger.log(`[SdkController] Rebuilding session ${oldSessionId} for mode change -> ${newMode} (wasRunning=${wasRunning})`)

		if (wasRunning) {
			await this.cancelRunningTurnForModeChange(oldManager, oldSessionId)
		}

		let autoContinueStarted = false
		let continuationSent = false
		let sessionReplaced = false
		try {
			const initialMessages = await this.options.loadInitialMessages(oldManager, oldSessionId)
			const cwd = await this.options.getWorkspaceRoot()
			const config = await this.options.sessionConfigBuilder.build({
				cwd,
				mode: newMode,
			})
			Logger.log(
				`[SdkController] Mode rebuild config: mode=${newMode}, provider=${config.providerId}, model=${config.modelId}, hasApiKey=${!!config.apiKey}`,
			)
			config.sessionId = oldSessionId

			if (usesClineAccountAuth(config.providerId) && !config.apiKey) {
				Logger.warn(
					`[SdkController] Mode rebuild: new mode '${newMode}' provider is '${config.providerId}' but no Cline auth token - emitting auth error`,
				)
				// The session still runs with the old mode's tools, so roll the
				// setting back to keep the UI toggle coherent with it.
				this.options.stateManager.setGlobalState("mode", previousMode)
				this.options.emitClineAuthError()
				await this.options.postStateToWebview()
				return false
			}

			const startInput = this.options.buildStartSessionInput(config, {
				cwd,
				mode: newMode,
			})
			const rebuildResult = await this.options.sessions.replaceActiveSession({
				startInput,
				initialMessages: initialMessages as InitialMessages,
				disposeReason: "modeChange",
			})
			if (!rebuildResult) {
				return false
			}

			sessionReplaced = true
			const { sdkHost, startResult } = rebuildResult
			const task = this.options.getTask()
			if (task && task.taskId !== startResult.sessionId) {
				Logger.warn(
					`[SdkController] Mode rebuild returned a new session ID (${startResult.sessionId}); updating task proxy`,
				)
				task.taskId = startResult.sessionId
			}

			this.options.resetMessageTranslator()
			// Record only after the session is actually replaced: a rebuild that
			// fails earlier rolls the mode setting back, and a notice for a switch
			// that never took effect would lie to the model. Recording before the
			// auto-continue send lets that send carry the notice.
			if (options.source === "ui") {
				this.recordModeSwitchNotice(startResult.sessionId, previousMode, newMode)
			}
			if (options.autoContinue) {
				const userPrompt = options.userContinuationPrompt
				const userImages = options.userImages
				const userFiles = options.userFiles
				// Mirror initTask/askResponse ordering: flip the phase and running flag
				// before anything is emitted or sent, so no listener ever sees a
				// user_feedback message while the phase still reads awaiting_followup.
				autoContinueStarted = true
				this.options.sessions.setRunning(true)
				this.options.onAutoContinueStarting()
				// Resolve mentions before echoing so a resolution failure cannot
				// leave an echoed-but-never-sent user message in the transcript.
				const prompt = userPrompt ? await this.options.resolveContextMentions(userPrompt) : ACT_MODE_CONTINUATION_PROMPT
				if (userPrompt || userImages?.length || userFiles?.length) {
					const userMessage: ClineMessage = {
						ts: Date.now(),
						type: "say",
						say: "user_feedback",
						text: userPrompt ?? "",
						images: userImages,
						files: userFiles,
						partial: false,
					}
					this.options.messages.appendAndEmit([userMessage], {
						type: "status",
						payload: { sessionId: startResult.sessionId, status: "running" },
					})
				}
				// Without a typed message the canned prompt drives the continuation; it
				// is intentionally not echoed as user_feedback, so no synthetic bubble
				// shows in chat. Attachments still ride along with the canned prompt.
				this.options.sessions.fireAndForgetSend(sdkHost, startResult.sessionId, prompt, userImages, userFiles)
				continuationSent = true
			}
			await this.options.postStateToWebview()

			Logger.log(`[SdkController] Session rebuilt for mode ${newMode}: ${oldSessionId} -> ${startResult.sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to rebuild session for mode change:", error)
			if (!sessionReplaced) {
				// The old session is still the active one and still has the old
				// mode's tools; leaving the setting flipped would show a toggle
				// that disagrees with what the agent can actually do.
				this.options.stateManager.setGlobalState("mode", previousMode)
			}
			if (continuationSent) {
				// The continuation is already running on the rebuilt session; the
				// only thing that can throw past the send is the post-rebuild state
				// post. Marking the live run as failed (or emitting a mode-switch
				// error) would lie about a turn that is actually in flight.
				return continuationSent
			}
			if (autoContinueStarted) {
				// The continuation send never happened (resolveContextMentions can
				// throw after the optimistic flip), so undo the running state and
				// move the phase to "error", otherwise the footer shows a phantom
				// run that nothing will ever finish.
				this.options.sessions.setRunning(false)
				this.options.onAutoContinueFailed()
			}
			const errorMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: `Failed to switch mode: ${error instanceof Error ? error.message : String(error)}`,
				partial: false,
			}
			this.options.messages.appendAndEmit([errorMessage], {
				type: "status",
				payload: { sessionId: oldSessionId, status: "error" },
			})
			await this.options.postStateToWebview()
		}
		return continuationSent
	}

	private async cancelRunningTurnForModeChange(oldManager: SdkSessionHost, oldSessionId: string): Promise<void> {
		this.options.interactions.clearPending("Mode changed")
		this.options.messages.cancelPendingSave()
		try {
			await oldManager.abort(oldSessionId)
		} catch (error) {
			if (!isAbortError(error)) {
				Logger.error("[SdkController] Failed to abort old session during mode change:", error)
			}
		}
		this.options.sessions.setRunning(false)

		const task = this.options.getTask()
		if (!task?.messageStateHandler) {
			return
		}

		const current = task.messageStateHandler.getClineMessages()
		const finalized = this.options.messages.finalizeMessagesForSave(current)
		this.options.messages.appendMessages(finalized)
	}
}
