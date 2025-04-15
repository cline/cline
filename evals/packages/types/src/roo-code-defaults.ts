import { RooCodeSettings } from "./roo-code.js"

export const rooCodeDefaults: RooCodeSettings = {
	apiProvider: "openrouter",
	openRouterUseMiddleOutTransform: false,

	// modelTemperature: null,
	// reasoningEffort: "high",
	rateLimitSeconds: 0,

	pinnedApiConfigs: {},
	lastShownAnnouncementId: "apr-04-2025-boomerang",

	autoApprovalEnabled: true,
	alwaysAllowReadOnly: true,
	alwaysAllowReadOnlyOutsideWorkspace: false,
	alwaysAllowWrite: true,
	alwaysAllowWriteOutsideWorkspace: false,
	writeDelayMs: 1000,
	alwaysAllowBrowser: true,
	alwaysApproveResubmit: true,
	requestDelaySeconds: 10,
	alwaysAllowMcp: true,
	alwaysAllowModeSwitch: true,
	alwaysAllowSubtasks: true,
	alwaysAllowExecute: true,
	allowedCommands: ["*"],

	browserToolEnabled: false,
	browserViewportSize: "900x600",
	screenshotQuality: 75,
	remoteBrowserEnabled: false,

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
	terminalShellIntegrationTimeout: 15_000,
	terminalCommandDelay: 0,
	terminalPowershellCounter: false,
	terminalZshClearEolMark: true,
	terminalZshOhMy: true,
	terminalZshP10k: false,
	terminalZdotdir: true,

	diffEnabled: true,
	fuzzyMatchThreshold: 1.0,
	experiments: {
		search_and_replace: false,
		insert_content: false,
		powerSteering: false,
	},

	language: "en",

	telemetrySetting: "enabled",

	mcpEnabled: false,
	mode: "code",
	customModes: [],
}
