import { ChatContent } from "@shared/ChatContent"
import { ChatSettings } from "@shared/ChatSettings"
import { ChatContent as ProtoChatContent, ChatSettings as ProtoChatSettings, PlanActMode } from "@shared/proto/cline/state"

/**
 * Converts domain ChatSettings objects to proto ChatSettings objects
 */
export function convertChatSettingsToProtoChatSettings(chatSettings: ChatSettings): ProtoChatSettings {
	return ProtoChatSettings.create({
		mode: chatSettings.mode === "plan" ? PlanActMode.PLAN : PlanActMode.ACT,
		preferredLanguage: chatSettings.preferredLanguage,
		openAiReasoningEffort: chatSettings.openAIReasoningEffort,
	})
}

/**
 * Converts proto ChatSettings objects to domain ChatSettings objects
 */
export function convertProtoChatSettingsToChatSettings(protoChatSettings: ProtoChatSettings): ChatSettings {
	return {
		mode: protoChatSettings.mode === PlanActMode.PLAN ? "plan" : "act",
		preferredLanguage: protoChatSettings.preferredLanguage,
		openAIReasoningEffort: protoChatSettings.openAiReasoningEffort as "low" | "medium" | "high" | undefined,
	}
}

/**
 * Converts domain ChatContent objects to proto ChatContent objects
 */
export function convertChatContentToProtoChatContent(chatContent?: ChatContent): ProtoChatContent | undefined {
	if (!chatContent) {
		return undefined
	}

	return ProtoChatContent.create({
		message: chatContent.message,
		images: chatContent.images || [],
		files: chatContent.files || [],
	})
}

/**
 * Converts proto ChatContent objects to domain ChatContent objects
 */
export function convertProtoChatContentToChatContent(protoChatContent?: ProtoChatContent): ChatContent | undefined {
	if (!protoChatContent) {
		return undefined
	}

	return {
		message: protoChatContent.message,
		images: protoChatContent.images || [],
		files: protoChatContent.files || [],
	}
}
