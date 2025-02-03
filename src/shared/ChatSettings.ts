export interface DiffAnimationSettings {
	mode: "all" | "changes-only" | "none"
	speed: "normal" | "2x" | "4x"
}

export interface ChatSettings {
	mode: "plan" | "act"
	diffAnimation: DiffAnimationSettings
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	mode: "act",
	diffAnimation: {
		mode: "all",
		speed: "normal",
	},
}
