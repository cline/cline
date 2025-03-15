export interface ChatSettings {
	mode: "plan" | "act"
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	mode: "act",
}
