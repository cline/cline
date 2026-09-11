import { Logger } from "@/shared/services/Logger"
import { sanitizeInitialMessagesForSessionStart } from "./initial-message-sanitizer"
import type { SdkInitialMessages, SdkSessionHost } from "./session-host"

export class SdkSessionHistoryLoader {
	async loadInitialMessages(sessionHost: SdkSessionHost, taskId: string): Promise<SdkInitialMessages | undefined> {
		try {
			// Prefer the live in-memory conversation: the persisted transcript
			// only catches up at turn boundaries, so a rebuild right after
			// aborting a turn (e.g. a plan/act mode switch mid-approval) would
			// otherwise read an empty file and drop the task context.
			const sdkMessages = await (sessionHost.readLiveMessages?.(taskId) ?? sessionHost.readMessages(taskId))
			if (sdkMessages.length > 0) {
				const sanitizedMessages = sanitizeInitialMessagesForSessionStart(sdkMessages)
				if (sanitizedMessages !== sdkMessages) {
					Logger.log(
						`[SdkController] Sanitized legacy pairing in SDK-persisted history for task: ${taskId} (${sdkMessages.length} → ${sanitizedMessages.length} messages)`,
					)
				}
				Logger.log(`[SdkController] Loaded ${sanitizedMessages.length} SDK-persisted messages for task: ${taskId}`)
				return sanitizedMessages
			}
		} catch (error) {
			Logger.warn("[SdkController] Failed to read SDK-persisted messages:", error)
		}

		try {
			const { getSavedApiConversationHistory } = await import("@core/storage/disk")
			const apiHistory = await getSavedApiConversationHistory(taskId)
			if (apiHistory.length > 0) {
				const sanitizedMessages = sanitizeInitialMessagesForSessionStart(apiHistory as SdkInitialMessages)
				if (sanitizedMessages !== apiHistory) {
					Logger.log(
						`[SdkController] Sanitized legacy pairing in classic API history for task: ${taskId} (${apiHistory.length} → ${sanitizedMessages.length} messages)`,
					)
				}
				Logger.log(`[SdkController] Loaded ${sanitizedMessages.length} classic API messages for task: ${taskId}`)
				return sanitizedMessages
			}
		} catch (error) {
			Logger.warn("[SdkController] Failed to read classic API conversation history:", error)
		}

		return undefined
	}
}
