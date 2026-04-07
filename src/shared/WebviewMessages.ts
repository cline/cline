/**
 * Typed message protocol for webview ↔ extension communication.
 *
 * Replaces the gRPC-over-postMessage protocol with simple JSON-serializable
 * TypeScript types. These messages are ephemeral (not persisted), so changes
 * are safe to make without migration concerns.
 *
 * During the transition period, both the old gRPC protocol and these typed
 * messages coexist. The webview accepts whichever arrives.
 */

import type { AutoApprovalSettings } from "./AutoApprovalSettings"
import type { ApiConfiguration, ModelInfo } from "./api"
import type { BrowserSettings } from "./BrowserSettings"
import type { ClineMessage, ExtensionState } from "./ExtensionMessage"
import type { McpMarketplaceCatalog, McpServer, McpViewTab } from "./mcp"
import type { Mode } from "./storage/types"

// ---------------------------------------------------------------------------
// Extension → Webview (Outbound) Messages
// ---------------------------------------------------------------------------

/** Full state push — replaces subscribeToState */
export interface StateMessage {
	type: "state"
	state: ExtensionState
}

/** Partial/streaming message update — replaces subscribeToPartialMessage */
export interface PartialMessage {
	type: "partialMessage"
	message: ClineMessage
}

/** Navigation command — replaces subscribeToXxxButtonClicked */
export interface NavigateMessage {
	type: "navigate"
	view: "mcp" | "settings" | "history" | "account" | "worktrees" | "chat"
	tab?: McpViewTab
	targetSection?: string
}

/** MCP servers update — replaces subscribeToMcpServers */
export interface McpServersMessage {
	type: "mcpServers"
	servers: McpServer[]
}

/** MCP marketplace catalog update — replaces subscribeToMcpMarketplaceCatalog */
export interface McpMarketplaceMessage {
	type: "mcpMarketplace"
	catalog: McpMarketplaceCatalog
}

/** Model list update — replaces subscribeToOpenRouterModels / subscribeToLiteLlmModels / refresh RPCs */
export interface ModelsMessage {
	type: "models"
	providerId: string
	models: Record<string, ModelInfo>
}

/** Relinquish control event — replaces subscribeToRelinquishControl */
export interface RelinquishControlMessage {
	type: "relinquishControl"
}

/** Add text to input — replaces subscribeToAddToInput */
export interface AddToInputMessage {
	type: "addToInput"
	text: string
}

/** Show webview event — replaces subscribeToShowWebview */
export interface ShowWebviewMessage {
	type: "showWebview"
	view?: string
}

/** Terminal profiles — replaces getAvailableTerminalProfiles response */
export interface TerminalProfilesMessage {
	type: "terminalProfiles"
	profiles: Array<{ id: string; name: string; path?: string; description?: string }>
}

/** Generic RPC response — for unary RPCs during transition */
export interface RpcResponseMessage {
	type: "rpcResponse"
	requestId: string
	method: string
	data?: unknown
	error?: string
}

export type WebviewOutbound =
	| StateMessage
	| PartialMessage
	| NavigateMessage
	| McpServersMessage
	| McpMarketplaceMessage
	| ModelsMessage
	| RelinquishControlMessage
	| AddToInputMessage
	| ShowWebviewMessage
	| TerminalProfilesMessage
	| RpcResponseMessage

// ---------------------------------------------------------------------------
// Webview → Extension (Inbound) Messages
// ---------------------------------------------------------------------------

/** Initialize the webview — replaces initializeWebview */
export interface ReadyMessage {
	type: "ready"
}

/** Start a new task — replaces newTask RPC */
export interface NewTaskMessage {
	type: "newTask"
	text: string
	images?: string[]
}

/** Send a response to a pending ask — replaces askResponse RPC */
export interface AskResponseMessage {
	type: "askResponse"
	response: string
	text?: string
	images?: string[]
}

/** Cancel the current task — replaces cancelTask RPC */
export interface CancelTaskMessage {
	type: "cancelTask"
}

/** Clear/reset the current task — replaces clearTask RPC */
export interface ClearTaskMessage {
	type: "clearTask"
}

/** Show a task from history — replaces showTaskWithId RPC */
export interface ShowTaskMessage {
	type: "showTask"
	id: string
}

/** Delete tasks — replaces deleteTasksWithIds / deleteAllTaskHistory RPCs */
export interface DeleteTasksMessage {
	type: "deleteTasks"
	ids: string[]
	all?: boolean
}

/** Get task history — replaces getTaskHistory RPC */
export interface GetTaskHistoryMessage {
	type: "getTaskHistory"
	offset?: number
	limit?: number
}

/** Update API configuration — replaces updateApiConfiguration / updateApiConfigurationProto RPCs */
export interface UpdateApiConfigMessage {
	type: "updateApiConfig"
	config: Partial<ApiConfiguration>
}

/** Toggle plan/act mode — replaces togglePlanActModeProto */
export interface ToggleModeMessage {
	type: "toggleMode"
	mode: Mode
}

/** Update settings — replaces updateSettings / updateAutoApprovalSettings RPCs */
export interface UpdateSettingsMessage {
	type: "updateSettings"
	settings: Record<string, unknown>
}

/** Update auto-approval settings — replaces updateAutoApprovalSettings */
export interface UpdateAutoApprovalMessage {
	type: "updateAutoApproval"
	settings: Partial<AutoApprovalSettings>
}

/** Update browser settings — replaces browser-related RPCs */
export interface UpdateBrowserSettingsMessage {
	type: "updateBrowserSettings"
	settings: Partial<BrowserSettings>
}

/** Update telemetry setting */
export interface UpdateTelemetryMessage {
	type: "updateTelemetry"
	value: string
}

/** Toggle favorite model */
export interface ToggleFavoriteModelMessage {
	type: "toggleFavoriteModel"
	modelId: string
}

/** Refresh models for a provider — replaces refresh*Models RPCs */
export interface RefreshModelsMessage {
	type: "refreshModels"
	providerId: string
	params?: Record<string, unknown>
}

/** Get models for a provider (e.g., Ollama, LM Studio) */
export interface GetModelsMessage {
	type: "getModels"
	providerId: string
	requestId: string
	params?: Record<string, unknown>
}

/** File operations — replaces FileServiceClient RPCs */
export interface FileOpMessage {
	type: "fileOp"
	op:
		| "open"
		| "openImage"
		| "openMention"
		| "openRelative"
		| "copyToClipboard"
		| "selectFiles"
		| "searchFiles"
		| "searchCommits"
		| "getRelativePaths"
		| "ifFileExists"
		| "openDiskConversationHistory"
	requestId?: string
	value?: string
	params?: Record<string, unknown>
}

/** Rule operations — replaces toggleClineRule, createRuleFile, etc. */
export interface RuleOpMessage {
	type: "ruleOp"
	op:
		| "toggleClineRule"
		| "toggleCursorRule"
		| "toggleWindsurfRule"
		| "toggleAgentsRule"
		| "toggleWorkflow"
		| "toggleHook"
		| "toggleSkill"
		| "createRule"
		| "deleteRule"
		| "createHook"
		| "deleteHook"
		| "createSkill"
		| "deleteSkill"
		| "refreshRules"
		| "refreshHooks"
		| "refreshSkills"
	requestId?: string
	params?: Record<string, unknown>
}

/** MCP operations — replaces McpServiceClient RPCs */
export interface McpOpMessage {
	type: "mcpOp"
	op:
		| "toggle"
		| "restart"
		| "delete"
		| "toggleToolAutoApprove"
		| "authenticate"
		| "updateTimeout"
		| "addRemote"
		| "openSettings"
		| "refreshMarketplace"
		| "download"
		| "getLatest"
	requestId?: string
	params?: Record<string, unknown>
}

/** Account operations — replaces AccountServiceClient RPCs */
export interface AccountOpMessage {
	type: "accountOp"
	op:
		| "login"
		| "logout"
		| "getCredits"
		| "getOrgCredits"
		| "getOrganizations"
		| "setOrganization"
		| "getRedirectUrl"
		| "openRouterAuth"
		| "requestyAuth"
		| "hicapAuth"
		| "openAiCodexSignIn"
		| "openAiCodexSignOut"
	requestId?: string
	params?: Record<string, unknown>
}

/** Worktree operations — replaces WorktreeServiceClient RPCs */
export interface WorktreeOpMessage {
	type: "worktreeOp"
	op:
		| "list"
		| "create"
		| "delete"
		| "switch"
		| "merge"
		| "getDefaults"
		| "getIncludeStatus"
		| "createInclude"
		| "getAvailableBranches"
		| "checkoutBranch"
		| "trackViewOpened"
	requestId?: string
	params?: Record<string, unknown>
}

/** Checkpoint operations — replaces CheckpointsServiceClient RPCs */
export interface CheckpointOpMessage {
	type: "checkpointOp"
	op: "diff" | "restore" | "getCwdHash"
	requestId?: string
	params?: Record<string, unknown>
}

/** Slash commands — replaces SlashServiceClient RPCs */
export interface SlashCommandMessage {
	type: "slashCommand"
	command: "condense"
	requestId?: string
	value?: string
}

/** Web operations — replaces WebServiceClient RPCs */
export interface WebOpMessage {
	type: "webOp"
	op: "checkIsImageUrl" | "fetchOpenGraphData" | "openInBrowser"
	requestId?: string
	value?: string
}

/** Browser operations — replaces BrowserServiceClient RPCs */
export interface BrowserOpMessage {
	type: "browserOp"
	op: "getConnectionInfo" | "testConnection" | "discoverBrowser" | "getDetectedChromePath" | "relaunchChromeDebugMode"
	requestId?: string
	value?: string
}

/** UI operations — replaces UiServiceClient RPCs */
export interface UiOpMessage {
	type: "uiOp"
	op:
		| "scrollToSettings"
		| "setTerminalExecutionMode"
		| "openUrl"
		| "openWalkthrough"
		| "onDidShowAnnouncement"
		| "dismissBanner"
		| "updateInfoBannerVersion"
		| "updateModelBannerVersion"
		| "updateCliBannerVersion"
		| "installClineCli"
		| "setWelcomeViewCompleted"
		| "captureOnboardingProgress"
		| "resetState"
	requestId?: string
	params?: Record<string, unknown>
}

/** State operations — replaces StateServiceClient RPCs */
export interface StateOpMessage {
	type: "stateOp"
	op:
		| "refreshRemoteConfig"
		| "testOtelConnection"
		| "testPromptUploading"
		| "getProcessInfo"
		| "flushPendingState"
		| "updateTerminalConnectionTimeout"
	requestId?: string
	params?: Record<string, unknown>
}

/** Task feedback / explain changes */
export interface TaskOpMessage {
	type: "taskOp"
	op: "feedback" | "viewChanges" | "explainChanges" | "export" | "toggleFavorite" | "cancelBackground" | "getTotalSize"
	requestId?: string
	params?: Record<string, unknown>
}

export type WebviewInbound =
	| ReadyMessage
	| NewTaskMessage
	| AskResponseMessage
	| CancelTaskMessage
	| ClearTaskMessage
	| ShowTaskMessage
	| DeleteTasksMessage
	| GetTaskHistoryMessage
	| UpdateApiConfigMessage
	| ToggleModeMessage
	| UpdateSettingsMessage
	| UpdateAutoApprovalMessage
	| UpdateBrowserSettingsMessage
	| UpdateTelemetryMessage
	| ToggleFavoriteModelMessage
	| RefreshModelsMessage
	| GetModelsMessage
	| FileOpMessage
	| RuleOpMessage
	| McpOpMessage
	| AccountOpMessage
	| WorktreeOpMessage
	| CheckpointOpMessage
	| SlashCommandMessage
	| WebOpMessage
	| BrowserOpMessage
	| UiOpMessage
	| StateOpMessage
	| TaskOpMessage

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard to check if a message is a typed webview message */
export function isTypedWebviewMessage(msg: unknown): msg is WebviewOutbound {
	return (
		typeof msg === "object" &&
		msg !== null &&
		"type" in msg &&
		typeof (msg as any).type === "string" &&
		(msg as any).type !== "grpc_request" &&
		(msg as any).type !== "grpc_response" &&
		(msg as any).type !== "grpc_request_cancel"
	)
}

/** Type guard to check if a message is an inbound typed message */
export function isTypedInboundMessage(msg: unknown): msg is WebviewInbound {
	return (
		typeof msg === "object" &&
		msg !== null &&
		"type" in msg &&
		typeof (msg as any).type === "string" &&
		(msg as any).type !== "grpc_request" &&
		(msg as any).type !== "grpc_response" &&
		(msg as any).type !== "grpc_request_cancel"
	)
}
