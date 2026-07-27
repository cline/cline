import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import type { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { isAbortError, type SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import { createTaskProxy, type TaskProxy } from "./task-proxy"

export interface SdkTaskControlCoordinatorOptions {
	sessions: SdkSessionLifecycle
	interactions: SdkInteractionCoordinator
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	getTask: () => TaskProxy | undefined
	setTask: (task: TaskProxy | undefined) => void
	onAskResponse: (text?: string, images?: string[], files?: string[]) => Promise<void>
	resetMessageTranslator: () => void
	postStateToWebview: () => Promise<void>
	/**
	 * Sets the authoritative turn phase. showTaskWithId must derive the phase
	 * from the reopened conversation (resumable/completed) — leaving the
	 * previous task's phase in place hides the Resume button for interrupted
	 * sessions opened from History (and can leak stale buttons in general).
	 */
	setTurnPhase: (phase: TurnPhase, anchorTs?: number) => void
	/**
	 * Raise the cancel fence SYNCHRONOUSLY before aborting the SDK session: bump the epoch so any
	 * straggler events the SDK emits after the abort request carry the old epoch (and are dropped
	 * by the webview), and mark the active turn cancelled so the session-event coordinator
	 * suppresses its remaining DISPLAY output (usage is still accounted).
	 */
	raiseCancelFence?: () => void
}

export class SdkTaskControlCoordinator {
	constructor(private readonly options: SdkTaskControlCoordinatorOptions) {}

	async cancelTask(): Promise<void> {
		this.options.interactions.clearPending("Task cancelled")

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.warn("[SdkController] cancelTask: No active session")
			return
		}

		const { sdkHost, sessionId } = activeSession

		// FENCE FIRST: raise the cancel fence synchronously BEFORE awaiting the abort. Any event
		// the SDK emits after this point carries the old epoch (dropped by the webview) and is
		// marked cancelled (display suppressed by the session-event coordinator; usage still
		// accounted). Order matters — aborting first would leave a window where a straggler gets
		// the new epoch.
		this.options.raiseCancelFence?.()

		try {
			await sdkHost.abort(sessionId)
		} catch (error) {
			if (!isAbortError(error)) {
				Logger.error("[SdkController] Failed to abort session:", error)
			} else {
				Logger.debug(`[SdkController] AbortError during cancelTask (expected): ${sessionId}`)
			}
		}

		this.options.sessions.setRunning(false)

		const resumeMessage: ClineMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "resume_task",
			text: "",
			partial: false,
		}
		this.options.messages.appendAndEmit([resumeMessage], { type: "status", payload: { sessionId, status: "cancelled" } })

		await this.options.postStateToWebview()
		Logger.log(`[SdkController] Task cancelled: ${sessionId}`)
	}

	async clearTask(): Promise<void> {
		this.options.interactions.clearPending("Task cleared")

		await this.options.sessions.endActiveSession("clearTask")

		const task = this.options.getTask()
		if (task) {
			// SDK session persistence owns conversation history. Do not write classic
			// ui_messages.json here; history viewing reloads from SDK readMessages().
			this.options.messages.cancelPendingSave()
			task.messageStateHandler.clear()
			this.options.setTask(undefined)
		}

		this.options.resetMessageTranslator()
	}

	async showTaskWithId(taskId: string, options: { skipHistoryLookup?: boolean } = {}): Promise<void> {
		try {
			if (!options.skipHistoryLookup) {
				const historyItem = await this.options.taskHistory.findHistoryItem(taskId)
				if (!historyItem) {
					Logger.error(`[SdkController] Task not found in history: ${taskId}`)
					return
				}
			}

			// When reopening the task that is currently active, wait for its stop to
			// land so the persisted session status read below reflects how the last
			// turn actually ended (completed vs cancelled) instead of a transient
			// non-terminal status.
			const activeSession = this.options.sessions.getActiveSession()
			await this.options.sessions.endActiveSession("showTaskWithId", {
				awaitStop: activeSession?.sessionId === taskId,
			})

			const currentTask = this.options.getTask()
			if (currentTask) {
				currentTask.messageStateHandler.clear()
			}

			this.options.resetMessageTranslator()

			// Load messages before installing the new task proxy so any concurrent
			// postStateToWebview() caller never sees the new id with empty messages.
			const isLegacyTask = await this.options.taskHistory.isLegacyTask(taskId)
			const sessionStatus = isLegacyTask ? undefined : await this.options.taskHistory.getSessionStatus(taskId)
			const rawMessages = await this.options.taskHistory.getClineMessages(taskId)
			const messages = this.options.messages.finalizeMessagesForSave(rawMessages)
			const cleanedMessages = isLegacyTask
				? this.appendLegacyTaskWarningAndResumeMessage(messages)
				: messages.length > 0
					? this.appendFreshResumeMessage(messages, sessionStatus)
					: []

			const task = createTaskProxy(
				taskId,
				(text?: string, images?: string[], files?: string[]) => this.options.onAskResponse(text, images, files),
				() => this.cancelTask(),
			)
			if (cleanedMessages.length > 0) {
				task.messageStateHandler.addMessages(cleanedMessages)
			}
			this.options.setTask(task)

			// Derive the turn phase from the appended resume ask. The webview
			// renders footer buttons from the authoritative TurnState, so without
			// this the phase left over from the previous context (often "idle")
			// hides the Resume button for interrupted/failed sessions.
			const lastMessage = cleanedMessages.at(-1)
			if (lastMessage?.type === "ask" && lastMessage.ask === "resume_completed_task") {
				this.options.setTurnPhase("completed", lastMessage.ts)
			} else if (lastMessage?.type === "ask" && lastMessage.ask === "resume_task") {
				this.options.setTurnPhase("resumable", lastMessage.ts)
			} else {
				this.options.setTurnPhase("idle")
			}

			if (cleanedMessages.length > 0) {
				Logger.log(`[SdkController] Loaded ${cleanedMessages.length} messages for task: ${taskId}`)
			} else {
				Logger.log(`[SdkController] No messages found for task: ${taskId}`)
			}

			// The final state update below includes the loaded clineMessages. Avoid pushing
			// each historical message through the partial-message stream one-by-one; for
			// long tasks that serial loop can dominate history-open latency.
			await this.options.postStateToWebview()
			Logger.log(`[SdkController] Showing task: ${taskId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to show task:", error)
		}
	}

	private appendFreshResumeMessage(messages: ClineMessage[], sessionStatus?: string): ClineMessage[] {
		// Prefer the persisted session status: SDK conversations do not record a
		// completion tool call in the transcript (a completed turn and a turn
		// interrupted mid-stream both end with plain assistant text), and history
		// rendering appends a synthetic trailing ask:"completion_result" either
		// way. Only the session status distinguishes "completed" from
		// "cancelled"/"failed" — interrupted tasks must get the Resume affordance.
		const lastRelevantMessage = [...messages]
			.reverse()
			.find((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
		const completed = sessionStatus
			? sessionStatus === "completed"
			: lastRelevantMessage?.ask === "completion_result"
		const resumeAsk = completed ? "resume_completed_task" : "resume_task"
		const cleanedMessages = messages.filter((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
		cleanedMessages.push({
			ts: Date.now(),
			type: "ask",
			ask: resumeAsk,
			text: "",
		})
		return cleanedMessages
	}

	private appendLegacyTaskWarningAndResumeMessage(messages: ClineMessage[]): ClineMessage[] {
		const cleanedMessages = messages.filter((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
		const now = Date.now()
		cleanedMessages.push(
			{
				ts: now,
				type: "say",
				say: "text",
				text: "⚠️ This is a legacy task. It may not work as well because tool names may have changed.",
			},
			{
				ts: now + 1,
				type: "ask",
				ask: "resume_task",
				text: "",
			},
		)
		return cleanedMessages
	}
}
