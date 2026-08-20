import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
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
	 * Drops the StateManager's task-scoped settings overlay (persisting pending
	 * writes first). Task settings — e.g. autoApprovalSettings written by
	 * toggling auto-approve while a task is open — shadow global settings in
	 * getGlobalSettingsKey(). If the overlay outlives the task view, later
	 * global updates are accepted but never surface in posted state (the stale
	 * overlay version wins), which froze the auto-approve checkboxes after
	 * "New Task" (#13260). Must run whenever the task view is cleared or
	 * switched to another task.
	 */
	clearTaskSettings: () => Promise<void>
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
	/**
	 * Generation counter for task-view mutations (showTaskWithId / clearTask).
	 * showTaskWithId awaits several reads before installing the task proxy; a
	 * request that loses the race to a newer mutation abandons installation at
	 * the next fence check so the user's latest selection always wins.
	 */
	private taskViewGeneration = 0

	constructor(private readonly options: SdkTaskControlCoordinatorOptions) {}

	async cancelClineTaskOnSignOut(isClineManagedProvider: boolean): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!isClineManagedProvider || !activeSession?.isRunning) {
			return
		}

		await this.cancelTask()
	}

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
		// Supersede any in-flight showTaskWithId so it cannot re-install a task
		// after the user cleared the view (e.g. clicked New Task).
		this.taskViewGeneration++
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

		await this.options.clearTaskSettings()

		this.options.resetMessageTranslator()
	}

	/**
	 * Opens a task from History. The view generation is allocated synchronously
	 * on entry — BEFORE any asynchronous work, including the history lookup —
	 * so the newest user selection always holds the newest generation and every
	 * older in-flight request self-abandons at its next fence check. (The
	 * lookup used to live in SdkController before the generation was taken; a
	 * stalled preflight could then re-enter with a NEWER generation than a
	 * later selection and replace it.)
	 *
	 * Returns the task's HistoryItem, or undefined when the task is unknown.
	 * A superseded call still returns the item (the lookup succeeded); it just
	 * skips mutating the task view.
	 */
	async showTaskWithId(taskId: string): Promise<HistoryItem | undefined> {
		const generation = ++this.taskViewGeneration
		const isSuperseded = (): boolean => {
			if (generation === this.taskViewGeneration) {
				return false
			}
			Logger.debug(`[SdkController] showTaskWithId superseded by a newer selection; skipping: ${taskId}`)
			return true
		}

		let historyItem: HistoryItem | undefined
		try {
			historyItem = await this.options.taskHistory.findHistoryItem(taskId)
		} catch (error) {
			Logger.error(`[SdkController] Failed to look up task in history: ${taskId}`, error)
			return undefined
		}
		if (!historyItem) {
			Logger.error(`[SdkController] Task not found in history: ${taskId}`)
			return undefined
		}

		// FENCE: before stopping the active session. A superseded request must
		// not stop a session that a newer selection just started or resumed.
		if (isSuperseded()) {
			return historyItem
		}

		try {
			// Reject any outstanding approval before tearing down the old session. Approval
			// resolvers live on the shared interaction coordinator, so ending the session
			// alone does not discard them; if one leaks across this task switch, the first
			// message sent in the newly selected task is consumed as the old task's response.
			this.options.interactions.clearPending("Task switched")

			// When reopening the task that is currently active, wait for its stop to
			// land so the persisted session status read below reflects how the last
			// turn actually ended (completed vs cancelled) instead of a transient
			// non-terminal status.
			const activeSession = this.options.sessions.getActiveSession()
			await this.options.sessions.endActiveSession("showTaskWithId", {
				awaitStop: activeSession?.sessionId === taskId,
			})

			// FENCE: everything below mutates the shared task view (clearing the
			// current task, installing the new proxy, setting the turn phase). If a
			// newer showTaskWithId/clearTask started while this call awaited I/O,
			// bail out so the stale request cannot clobber the newer selection.
			if (isSuperseded()) {
				return historyItem
			}

			const currentTask = this.options.getTask()
			if (currentTask) {
				currentTask.messageStateHandler.clear()
			}

			// The outgoing task's settings overlay must not apply to the newly
			// opened task (see clearTaskSettings option doc).
			await this.options.clearTaskSettings()

			this.options.resetMessageTranslator()

			// Load messages before installing the new task proxy so any concurrent
			// postStateToWebview() caller never sees the new id with empty messages.
			const isLegacyTask = await this.options.taskHistory.isLegacyTask(taskId)
			const sessionStatus = isLegacyTask ? undefined : await this.options.taskHistory.getSessionStatus(taskId)
			const rawMessages = await this.options.taskHistory.getClineMessages(taskId)
			if (isSuperseded()) {
				return historyItem
			}
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
		return historyItem
	}

	private appendFreshResumeMessage(messages: ClineMessage[], sessionStatus?: string): ClineMessage[] {
		// The persisted session status is the only reliable completion signal:
		// SDK conversations do not record a completion tool call in the
		// transcript (a completed turn and a turn interrupted mid-stream both
		// end with plain assistant text), and history rendering appends a
		// synthetic trailing ask:"completion_result" either way, so the message
		// tail cannot be used. When the status is unknown (e.g. a transient
		// read failure), default to the Resume affordance: resuming a completed
		// task is harmless, while hiding Resume on an interrupted one is the
		// data-loss illusion this exists to prevent.
		const resumeAsk = sessionStatus === "completed" ? "resume_completed_task" : "resume_task"
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
