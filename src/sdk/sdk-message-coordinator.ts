import type { CoreSessionEvent } from "@clinebot/core"
import type { ClineApiReqInfo, ClineMessage } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import type { TaskProxy } from "./task-proxy"
import { pushMessageToWebview } from "./webview-grpc-bridge"

export type SessionEventListener = (messages: ClineMessage[], event: CoreSessionEvent) => void

export interface SdkMessageCoordinatorOptions {
	getTask: () => TaskProxy | undefined
}

export class SdkMessageCoordinator {
	private readonly sessionEventListeners = new Set<SessionEventListener>()
	private saveClineMessagesTimer: ReturnType<typeof setTimeout> | undefined

	constructor(private readonly options: SdkMessageCoordinatorOptions) {}

	dispose(): void {
		this.cancelPendingSave()
		this.sessionEventListeners.clear()
	}

	cancelPendingSave(): void {
		if (this.saveClineMessagesTimer) {
			clearTimeout(this.saveClineMessagesTimer)
			this.saveClineMessagesTimer = undefined
		}
	}

	onSessionEvent(listener: SessionEventListener): () => void {
		this.sessionEventListeners.add(listener)
		return () => {
			this.sessionEventListeners.delete(listener)
		}
	}

	emitSessionEvents(messages: ClineMessage[], event: CoreSessionEvent): void {
		for (const listener of this.sessionEventListeners) {
			try {
				listener(messages, event)
			} catch (error) {
				Logger.error("[SdkController] Error in session event listener:", error)
			}
		}
	}

	appendMessages(messages: ClineMessage[], options: { save?: boolean } = {}): void {
		const task = this.options.getTask()
		if (!task?.messageStateHandler) {
			return
		}

		task.messageStateHandler.addMessages(messages)

		if (options.save ?? true) {
			this.debouncedSaveClineMessages()
		}
	}

	appendAndEmit(messages: ClineMessage[], event: CoreSessionEvent, options: { save?: boolean } = {}): void {
		this.appendMessages(messages, options)
		this.emitSessionEvents(messages, event)
	}

	emitHookMessage(message: ClineMessage): void {
		this.appendMessages([message])
		pushMessageToWebview(message).catch(() => {})
	}

	debouncedSaveClineMessages(): void {
		if (this.saveClineMessagesTimer) {
			clearTimeout(this.saveClineMessagesTimer)
		}
		this.saveClineMessagesTimer = setTimeout(() => {
			this.saveClineMessagesTimer = undefined
			this.saveClineMessagesNow().catch((err) => {
				Logger.error("[SdkController] Failed to save ClineMessages:", err)
			})
		}, 500)
	}

	async saveClineMessagesNow(): Promise<void> {
		const task = this.options.getTask()
		const taskId = task?.taskId
		if (!taskId || !task?.messageStateHandler) {
			return
		}
		const messages = task.messageStateHandler.getClineMessages()
		if (messages.length === 0) {
			return
		}
		try {
			const { saveClineMessages } = await import("@core/storage/disk")
			await saveClineMessages(taskId, messages)
		} catch (error) {
			Logger.error("[SdkController] saveClineMessagesNow error:", error)
		}
	}

	/**
	 * Finalize messages for saving to disk when a task is being cleared.
	 * - Strips `partial` flags so the UI doesn't show a streaming/cancel state
	 * - Updates the last `api_req_started` with a cancel reason if it has no cost
	 */
	finalizeMessagesForSave(messages: ClineMessage[]): ClineMessage[] {
		return messages.map((msg, index) => {
			const updated = { ...msg }

			if (updated.partial) {
				delete updated.partial
			}

			if (updated.type === "say" && updated.say === "api_req_started") {
				try {
					const info: ClineApiReqInfo = JSON.parse(updated.text || "{}")
					if (info.cost === undefined && info.cancelReason === undefined) {
						const isLast = !messages.slice(index + 1).some((m) => m.type === "say" && m.say === "api_req_started")
						if (isLast) {
							info.cancelReason = "user_cancelled"
							updated.text = JSON.stringify(info)
						}
					}
				} catch {
					// Ignore parse errors from legacy or malformed messages.
				}
			}

			return updated
		})
	}
}
