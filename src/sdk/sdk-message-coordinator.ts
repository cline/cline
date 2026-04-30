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

	appendMessages(messages: ClineMessage[]): void {
		const task = this.options.getTask()
		if (!task?.messageStateHandler) {
			return
		}

		task.messageStateHandler.addMessages(messages)
	}

	appendAndEmit(messages: ClineMessage[], event: CoreSessionEvent): void {
		this.appendMessages(messages)
		this.emitSessionEvents(messages, event)
	}

	emitHookMessage(message: ClineMessage): void {
		this.appendMessages([message])
		pushMessageToWebview(message).catch(() => {})
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
