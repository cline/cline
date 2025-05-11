export interface VsCodeLmModelSelectorConfig {
	vendor?: string
	family?: string
}

export interface GeneralSettings {
	mcpMode: "full" | "server-use-only" | "off"
	enableCheckpoints: boolean
	disableBrowserTool: boolean
	o3MiniReasoningEffort: "low" | "medium" | "high"
	chromeExecutablePath: string | null
	vsCodeLmModelSelector: VsCodeLmModelSelectorConfig | null
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
	mcpMode: "full",
	enableCheckpoints: true,
	disableBrowserTool: false,
	o3MiniReasoningEffort: "medium",
	chromeExecutablePath: null,
	vsCodeLmModelSelector: null,
}
