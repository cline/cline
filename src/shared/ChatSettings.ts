export type OpenAIReasoningEffort = "low" | "medium" | "high"

export type Mode = "plan" | "act"

export interface ChatSettings {
	mode: Mode
	preferredLanguage?: string
	openAIReasoningEffort?: OpenAIReasoningEffort
}

export type PartialChatSettings = Partial<ChatSettings>

// Type for chat settings stored in workspace (excludes in-memory mode)
export type StoredChatSettings = Omit<ChatSettings, "mode">

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	mode: "act",
	preferredLanguage: "English",
	openAIReasoningEffort: "medium",
}
