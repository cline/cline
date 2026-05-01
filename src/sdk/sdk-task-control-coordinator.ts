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

		const activeSession = this.options.sessions.clearActiveSessionReference()
		if (activeSession) {
			const { sdkHost, unsubscribe, sessionId } = activeSession
			unsubscribe()

			// Do not block the webview on SDK shutdown. `stop()`/`dispose()` can take
			// seconds (or hit their timeouts) while the UI only needs the active
			// session reference and task proxy cleared synchronously.
			this.stopAndDisposeSessionInBackground(sdkHost, sessionId)
		}

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

	private stopAndDisposeSessionInBackground(
		sdkHost: { stop(sessionId: string): Promise<unknown>; dispose(reason: string): Promise<unknown> },
		sessionId: string,
	): void {
		const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
			Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))])

		void (async () => {
			const startedAt = Date.now()
			try {
				await withTimeout(sdkHost.stop(sessionId), 3000)
			} catch (error) {
				Logger.warn("[SdkController] Error stopping session during clear:", error)
			}

			try {
				await withTimeout(sdkHost.dispose("clearTask"), 3000)
			} catch (error) {
				Logger.warn("[SdkController] Error disposing session manager during clear:", error)
			}

			const elapsed = Date.now() - startedAt
			if (elapsed > 250) {
				Logger.log(`[SdkController] Background session cleanup after clearTask took ${elapsed}ms for ${sessionId}`)
			}
		})()
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

			this.silentlyTearDownActiveSession()

			const currentTask = this.options.getTask()
			if (currentTask) {
				currentTask.messageStateHandler.clear()
			}

			this.options.resetMessageTranslator()

			const task = createTaskProxy(
				taskId,
				(text?: string, images?: string[], files?: string[]) => this.options.onAskResponse(text, images, files),
				() => this.cancelTask(),
			)
			this.options.setTask(task)

			const rawMessages = await this.options.taskHistory.getClineMessages(taskId)
			const messages = this.options.messages.finalizeMessagesForSave(rawMessages)

			if (messages.length > 0) {
				const cleanedMessages = this.appendFreshResumeMessage(messages)
				this.options.messages.appendMessages(cleanedMessages)
				Logger.log(`[SdkController] Loaded ${cleanedMessages.length} messages for task: ${taskId}`)

				const { pushMessageToWebview } = await import("./webview-grpc-bridge")
				for (const msg of cleanedMessages) {
					await pushMessageToWebview(msg)
				}
			} else {
				Logger.log(`[SdkController] No messages found for task: ${taskId}`)
			}

			await this.options.postStateToWebview()
			Logger.log(`[SdkController] Showing task: ${taskId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to show task:", error)
		}
	}

	private silentlyTearDownActiveSession(): void {
		const activeSession = this.options.sessions.clearActiveSessionReference()
		if (!activeSession) {
			return
		}

		const { sdkHost, unsubscribe, sessionId } = activeSession
		unsubscribe()
		sdkHost.stop(sessionId).catch(() => {})
		sdkHost.dispose("showTaskWithId").catch(() => {})
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
