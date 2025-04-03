import { RooCodeSettings } from "./roo-code.js"

export const rooCodeDefaults: RooCodeSettings = {
	apiProvider: "openrouter",
	openRouterModelId: "google/gemini-2.0-flash-001", // "anthropic/claude-3.7-sonnet",

	pinnedApiConfigs: {},
	lastShownAnnouncementId: "mar-20-2025-3-10",

	autoApprovalEnabled: true,
	alwaysAllowReadOnly: true,
	alwaysAllowReadOnlyOutsideWorkspace: false,
	alwaysAllowWrite: true,
	alwaysAllowWriteOutsideWorkspace: false,
	writeDelayMs: 200,
	alwaysAllowBrowser: true,
	alwaysApproveResubmit: true,
	requestDelaySeconds: 5,
	alwaysAllowMcp: true,
	alwaysAllowModeSwitch: true,
	alwaysAllowSubtasks: true,
	alwaysAllowExecute: true,
	allowedCommands: ["*"],

	browserToolEnabled: false,
	browserViewportSize: "900x600",
	screenshotQuality: 38,
	remoteBrowserEnabled: true,

	enableCheckpoints: false,
	checkpointStorage: "task",

	ttsEnabled: false,
	ttsSpeed: 1,
	soundEnabled: false,
	soundVolume: 0.5,

	maxOpenTabsContext: 20,
	maxWorkspaceFiles: 200,
	showRooIgnoredFiles: true,
	maxReadFileLine: 500,

	terminalOutputLineLimit: 500,
	terminalShellIntegrationTimeout: 15000,

	rateLimitSeconds: 0,
	diffEnabled: true,
	fuzzyMatchThreshold: 1.0,
	experiments: {
		multi_search_and_replace: false,
		search_and_replace: true,
		insert_content: false,
		powerSteering: false,
	},

	language: "en",

	telemetrySetting: "enabled",

	mcpEnabled: false,
	mode: "code",
	customModes: [],
}
