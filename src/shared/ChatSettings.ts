export interface ChatSettings {
	mode: "task" | "chat"
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	mode: "task",
}
