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
import type { SdkTaskHistory } from "./sdk-task-history"
import { prepareTaskResumeStartInput } from "./sdk-task-resume"
import type { SdkSessionHost } from "./session-host"
import type { TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

/**
 * Sent when the user resumes a task without typing anything: a turn cannot
 * start without a prompt, so the Resume button needs a synthetic one. Never
 * include the original task text here — the model treats it as new
 * instructions and redoes already-completed work (#12975). Hidden from the
 * transcript by isSyntheticUserPrompt via the [TASK RESUMPTION] prefix.
 */
const TASK_RESUMPTION_PROMPT = "[TASK RESUMPTION] Please continue where you left off."

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
	/** Resolves once no session rebuild is in flight. */
	waitForPendingRebuilds: () => Promise<void>
	/** Serializes transcript preparation and session start with rebuilds and displayed-task compaction. */
	runExclusive: (operation: () => Promise<void>) => Promise<void>
	/**
	 * Called when resuming a task fails. askResponse moved the turn phase to
	 * streaming before delegating here, so the failure must move it to a
	 * terminal phase or the footer stays stuck on Thinking/Cancel.
	 */
	onResumeFailed: () => void
	/**
	 * Called when a follow-up ends without starting a turn (the displayed task
	 * changed, or no session could be chosen). Settles the streaming phase that
	 * askResponse pre-set, for the same reason as onResumeFailed.
	 */
	onFollowUpAbandoned: () => void
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
		if (this.options.interactions.resolvePendingToolApproval(prompt, askResponse, images, files)) {
			return
		}

		if (this.options.interactions.resolvePendingAskQuestion(prompt)) {
			return
		}

		const activeSession = this.options.sessions.getActiveSession()
		const task = this.options.getTask()
		const submittedDuringActiveTurn = turnPhaseAtSubmit === "streaming" || turnPhaseAtSubmit === "awaiting_approval"
		if (activeSession && (activeSession.isRunning || submittedDuringActiveTurn)) {
			await this.queueToActiveSession(activeSession, prompt, images, files)
			return
		}

		// Rebuilds replace idle sessions. Wait before acquiring the shared
		// prepare/start boundary so this follow-up cannot target a replaced host.
		await this.options.waitForPendingRebuilds()

		await this.options.runExclusive(async () => {
			// Task navigation does not use the rebuild scheduler. Do not deliver a
			// prompt submitted from one task into a task selected while we waited.
			// Compare by taskId: reloading the same task allocates a new TaskProxy,
			// and the user's follow-up should survive that.
			if (task && this.options.getTask()?.taskId !== task.taskId) {
				await this.abandonFollowUp(
					`askResponse: Task changed while waiting to resume ${task.taskId}; cancelling follow-up`,
				)
				return
			}

			const currentSession = this.options.sessions.getActiveSession()
			if (currentSession && (currentSession.isRunning || submittedDuringActiveTurn)) {
				await this.queueToActiveSession(currentSession, prompt, images, files)
				return
			}

			// Stopping a turn keeps the session alive, so a matching idle
			// session is continued in place — mirroring the CLI, which reuses
			// the live session after an abort. Rebuilding from task history is
			// reserved for tasks without a live session (opened from history,
			// extension host reload).
			if (currentSession && (!task || currentSession.sessionId === task.taskId)) {
				await this.continueIdleSession(currentSession, prompt, images, files)
				return
			}

			if (task) {
				Logger.log(`[SdkController] askResponse: Resuming task ${task.taskId} before follow-up`)
				await this.tryResumeSessionFromTask(task, prompt, images, files)
				return
			}

			Logger.error("[SdkController] askResponse: No active session")
			await this.abandonFollowUp("askResponse: No active session to receive the follow-up")
		})
	}

	/** Queue a follow-up onto a session whose turn is still running. */
	private async queueToActiveSession(
		activeSession: NonNullable<ReturnType<SdkSessionLifecycle["getActiveSession"]>>,
		prompt?: string,
		images?: string[],
		files?: string[],
	): Promise<void> {
		const { sdkHost, sessionId } = activeSession
		Logger.log(`[SdkController] Session is running - queuing follow-up message for session: ${sessionId}`)

		this.options.sessions.setRunning(true)
		const resolvedPrompt = prompt ? await this.options.resolveContextMentions(prompt) : ""
		this.options.sessions.fireAndForgetSend(sdkHost, sessionId, resolvedPrompt, images, files, "queue")
	}

	/**
	 * Continue a live idle session in place instead of tearing it down and
	 * rebuilding it from task history. A bare resume (no user content) sends
	 * the synthetic resumption prompt without echoing a user bubble;
	 * user-provided content is echoed and sent as-is. If the session's abort
	 * is still settling, the runtime auto-queues the send and drains it once
	 * the abort completes.
	 */
	private async continueIdleSession(
		activeSession: NonNullable<ReturnType<SdkSessionLifecycle["getActiveSession"]>>,
		prompt?: string,
		images?: string[],
		files?: string[],
	): Promise<void> {
		const { sdkHost, sessionId } = activeSession
		Logger.log(`[SdkController] Continuing idle session for follow-up: ${sessionId}`)

		this.options.sessions.setRunning(true)
		if (prompt?.trim() || images?.length || files?.length) {
			this.emitUserFeedback(sessionId, prompt, images, files)
		}
		this.options.resetMessageTranslator()

		const effectivePrompt = prompt?.trim() || TASK_RESUMPTION_PROMPT
		const resolvedPrompt = await this.options.resolveContextMentions(effectivePrompt)
		this.options.sessions.fireAndForgetSend(sdkHost, sessionId, resolvedPrompt, images, files)
	}

	private async tryResumeSessionFromTask(task: TaskProxy, prompt?: string, images?: string[], files?: string[]): Promise<void> {
		try {
			await this.resumeSessionFromTask(task, prompt, images, files)
		} catch (error) {
			if (this.options.getTask()?.taskId !== task.taskId) {
				// Settle the pre-set streaming phase, but do not emit the stale
				// failure into the newly displayed task's transcript.
				await this.abandonFollowUp(`Suppressing resume failure for task no longer displayed: ${task.taskId}`)
				return
			}
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
					{ type: "status", payload: { sessionId: task.taskId, status: "error" } },
				)
			}
			this.options.onResumeFailed()
			await this.options.postStateToWebview()
		}
	}

	private async resumeSessionFromTask(task: TaskProxy, prompt?: string, images?: string[], files?: string[]): Promise<void> {
		const taskId = task.taskId
		Logger.log(`[SdkController] Resuming session from task: ${taskId}`)

		const historyItem = await this.options.taskHistory.findHistoryItem(taskId)
		const resumeStart = await prepareTaskResumeStartInput(this.options, taskId)
		// Targeting checks below compare by taskId (logical identity): reloading
		// the same task allocates a new TaskProxy and must not cancel the
		// follow-up. Cleanup (endStartedResume) uses object identity instead.
		if (this.options.getTask()?.taskId !== taskId) {
			await this.abandonFollowUp(`Task changed before resume start for ${taskId}; cancelling follow-up`)
			return
		}

		Logger.log(`[SdkController] Resuming with ${resumeStart.initialMessages?.length ?? 0} initial messages`)

		const { startResult, sdkHost } = await this.options.sessions.startNewSession({
			...resumeStart,
			interactive: true,
		})

		if (this.options.getTask()?.taskId !== taskId) {
			await this.endStartedResume(sdkHost, startResult.sessionId)
			await this.abandonFollowUp(`Task changed during resume start for ${taskId}; cancelled follow-up`)
			return
		}

		try {
			if (historyItem) {
				historyItem.ts = Date.now()
				historyItem.modelId = resumeStart.config.modelId
				await this.options.taskHistory.updateTaskHistoryItem(historyItem)
				if (this.options.getTask()?.taskId !== taskId) {
					await this.endStartedResume(sdkHost, startResult.sessionId)
					await this.abandonFollowUp(`Task changed while updating history for ${taskId}; cancelled follow-up`)
					return
				}
			}

			const effectivePrompt = prompt?.trim() || TASK_RESUMPTION_PROMPT
			const resolvedPrompt = await this.options.resolveContextMentions(effectivePrompt)
			if (this.options.getTask()?.taskId !== taskId) {
				await this.endStartedResume(sdkHost, startResult.sessionId)
				await this.abandonFollowUp(`Task changed while resolving mentions for ${taskId}; cancelled follow-up`)
				return
			}

			if (task.taskId !== startResult.sessionId) {
				task.taskId = startResult.sessionId
			}
			this.options.resetMessageTranslator()

			// Echo whenever the user supplied content, including attachment-only
			// resumes, and include the attachments in the bubble. This also keeps the
			// visible transcript aligned with SDK history for edit/regenerate ordinal
			// mapping: a resumption prompt carrying user attachments is counted as a
			// visible user message, a bare resumption prompt is not.
			if (prompt?.trim() || images?.length || files?.length) {
				this.emitUserFeedback(startResult.sessionId, prompt, images, files)
			}

			await this.options.postStateToWebview()
			// Compare against the original taskId: a proxy reloaded from history
			// carries it, while task.taskId may have been reassigned above.
			if (this.options.getTask()?.taskId !== taskId && this.options.getTask() !== task) {
				await this.endStartedResume(sdkHost, startResult.sessionId)
				await this.abandonFollowUp(`Task changed while posting resumed state for ${taskId}; cancelled follow-up`)
				return
			}

			this.options.sessions.fireAndForgetSend(sdkHost, startResult.sessionId, resolvedPrompt, images, files)
		} catch (error) {
			await this.endStartedResume(sdkHost, startResult.sessionId)
			throw error
		}
	}

	private async endStartedResume(sdkHost: SdkSessionHost, sessionId: string): Promise<void> {
		// startNewSession installs the session before resolving. Clear that exact
		// session synchronously, but never stop a replacement session.
		const activeSession = this.options.sessions.getActiveSession()
		if (activeSession?.sdkHost === sdkHost && activeSession.sessionId === sessionId) {
			await this.options.sessions.endActiveSession("followupTargetChanged", { awaitStop: true })
		}
	}

	/** Settle the pre-set streaming phase for a follow-up that started no turn. */
	private async abandonFollowUp(detail: string): Promise<void> {
		Logger.log(`[SdkController] ${detail}`)
		this.options.onFollowUpAbandoned()
		await this.options.postStateToWebview()
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
