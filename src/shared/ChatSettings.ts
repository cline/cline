export interface ChatSettings {
	mode: "plan" | "act"
	thinkingValue?: number // Value from 0-10000
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	mode: "act",
	thinkingValue: 0, // Default value
}
