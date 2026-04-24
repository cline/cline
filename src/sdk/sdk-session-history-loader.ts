import { Logger } from "@/shared/services/Logger"
import { sanitizeInitialMessagesForSessionStart } from "./initial-message-sanitizer"

export interface SessionHistoryReader {
	readMessages(id: string): Promise<unknown[]>
}

export class SdkSessionHistoryLoader {
	async loadInitialMessages(reader: SessionHistoryReader, taskId: string): Promise<unknown[] | undefined> {
		try {
			const sdkMessages = await reader.readMessages(taskId)
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
				const sanitizedMessages = sanitizeInitialMessagesForSessionStart(apiHistory as unknown[])
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
