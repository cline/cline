export type OpenAIReasoningEffort = "low" | "medium" | "high"

export interface ChatSettings {
	mode: "plan" | "act"
	preferredLanguage?: string
	openAIReasoningEffort?: OpenAIReasoningEffort
	voiceRecordingEnabled?: boolean
}

export type PartialChatSettings = Partial<ChatSettings>

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	mode: "act",
	preferredLanguage: "English",
	openAIReasoningEffort: "medium",
	voiceRecordingEnabled: true,
}
