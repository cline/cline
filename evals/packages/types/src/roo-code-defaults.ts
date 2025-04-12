import { RooCodeSettings } from "./roo-code.js"

export const rooCodeDefaults: RooCodeSettings = {
	apiProvider: "openrouter",
	openRouterModelId: "google/gemini-2.0-flash-001", // "anthropic/claude-3.7-sonnet",

	// apiProvider: "openai",
	// openAiBaseUrl: "http://hrudolph.duckdns.org:4269/api/v1",
	// openAiApiKey: process.env.OPENAI_API_KEY,
	// openAiModelId: "models/gemini-2.5-pro-exp-03-25",
	// openAiCustomModelInfo: {
	// 	maxTokens: 65536,
	// 	contextWindow: 1000000,
	// 	supportsImages: true,
	// 	supportsPromptCache: false,
	// 	inputPrice: 0,
	// 	outputPrice: 0,
	// 	description:
	// 		"Gemini 2.5 Pro is Google’s state-of-the-art AI model designed for advanced reasoning, coding, mathematics, and scientific tasks. It employs “thinking” capabilities, enabling it to reason through responses with enhanced accuracy and nuanced context handling. Gemini 2.5 Pro achieves top-tier performance on multiple benchmarks, including first-place positioning on the LMArena leaderboard, reflecting superior human-preference alignment and complex problem-solving abilities.",
	// 	thinking: false,
	// },

	modelTemperature: null,
	// reasoningEffort: "high",

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
	terminalShellIntegrationTimeout: 15000,

	diffEnabled: true,
	fuzzyMatchThreshold: 1.0,
	experiments: {
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
