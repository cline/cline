import { RooCodeSettings } from "./roo-code.js"

export const rooCodeDefaults: RooCodeSettings = {
	apiProvider: "openrouter",
	openRouterUseMiddleOutTransform: false,

	lastShownAnnouncementId: "apr-30-2025-3-15",

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

	enableCheckpoints: false,

	maxOpenTabsContext: 20,
	maxWorkspaceFiles: 200,
	showRooIgnoredFiles: true,
	maxReadFileLine: 500,

	terminalShellIntegrationDisabled: true,

	mcpEnabled: false,

	mode: "code",
}
