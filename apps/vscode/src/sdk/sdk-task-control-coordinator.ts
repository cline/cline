import type { ClineMessage } from "@shared/ExtensionMessage"
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
		const startedAt = Date.now()
		try {
			if (!options.skipHistoryLookup) {
				const lookupStartedAt = Date.now()
				const historyItem = await this.options.taskHistory.findHistoryItem(taskId)
				Logger.log(
					`[HistoryPerf] SdkTaskControlCoordinator.showTaskWithId taskId=${taskId} historyLookup=${Date.now() - lookupStartedAt}ms`,
				)
				if (!historyItem) {
					Logger.error(`[SdkController] Task not found in history: ${taskId}`)
					return
				}
			}

			const teardownStartedAt = Date.now()
			await this.options.sessions.endActiveSession("showTaskWithId")
			const teardownElapsed = Date.now() - teardownStartedAt

			const currentTask = this.options.getTask()
			if (currentTask) {
				currentTask.messageStateHandler.clear()
			}

			this.options.resetMessageTranslator()

			// Load messages before installing the new task proxy so any concurrent
			// postStateToWebview() caller never sees the new id with empty messages.
			const loadMessagesStartedAt = Date.now()
			const rawMessages = await this.options.taskHistory.getClineMessages(taskId)
			const loadMessagesElapsed = Date.now() - loadMessagesStartedAt
			const finalizeStartedAt = Date.now()
			const messages = this.options.messages.finalizeMessagesForSave(rawMessages)
			const cleanedMessages = messages.length > 0 ? this.appendFreshResumeMessage(messages) : []
			const finalizeElapsed = Date.now() - finalizeStartedAt

			const task = createTaskProxy(
				taskId,
				(text?: string, images?: string[], files?: string[]) => this.options.onAskResponse(text, images, files),
				() => this.cancelTask(),
			)
			if (cleanedMessages.length > 0) {
				task.messageStateHandler.addMessages(cleanedMessages)
			}
			this.options.setTask(task)

			if (cleanedMessages.length > 0) {
				Logger.log(`[SdkController] Loaded ${cleanedMessages.length} messages for task: ${taskId}`)
			} else {
				Logger.log(`[SdkController] No messages found for task: ${taskId}`)
			}

			// The final state update below includes the loaded clineMessages. Avoid pushing
			// each historical message through the partial-message stream one-by-one; for
			// long tasks that serial loop can dominate history-open latency.
			const postStateStartedAt = Date.now()
			await this.options.postStateToWebview()
			const postStateElapsed = Date.now() - postStateStartedAt
			Logger.log(
				`[HistoryPerf] SdkTaskControlCoordinator.showTaskWithId taskId=${taskId} rawMessages=${rawMessages.length} cleanedMessages=${cleanedMessages.length} teardown=${teardownElapsed}ms loadMessages=${loadMessagesElapsed}ms finalize=${finalizeElapsed}ms push=skipped postState=${postStateElapsed}ms total=${Date.now() - startedAt}ms`,
			)
			Logger.log(`[SdkController] Showing task: ${taskId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to show task:", error)
		}
	}

	private appendFreshResumeMessage(messages: ClineMessage[]): ClineMessage[] {
		const lastRelevantMessage = [...messages]
			.reverse()
			.find((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
		const resumeAsk = lastRelevantMessage?.ask === "completion_result" ? "resume_completed_task" : "resume_task"
		const cleanedMessages = messages.filter((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
		cleanedMessages.push({
			ts: Date.now(),
			type: "ask",
			ask: resumeAsk,
			text: "",
		})
		return cleanedMessages
	}
}
