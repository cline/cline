import { ApiConfiguration } from "./api"
import { BrowserSettings } from "./BrowserSettings"
import { ChatSettings } from "./ChatSettings"
import { UserInfo } from "./UserInfo"
import { ChatContent } from "./ChatContent"
import { TelemetrySetting } from "./TelemetrySetting"
import { McpViewTab } from "./mcp"

export interface WebviewMessage {
	type:
		| "apiConfiguration"
		| "newTask"
		| "condense"
		| "reportBug"
		| "requestVsCodeLmModels"
		| "authStateChanged"
		| "fetchMcpMarketplace"
		| "searchCommits"
		| "fetchLatestMcpServersFromHub"
		| "telemetrySetting"
		| "updateSettings"
		| "clearAllTaskHistory"
		| "fetchUserCreditsData"
		| "searchFiles"
		| "grpc_request"
		| "grpc_request_cancel"
		| "toggleWorkflow"
		| "executeQuickWin"

	text?: string
	disabled?: boolean
	apiConfiguration?: ApiConfiguration
	images?: string[]
	files?: string[]
	bool?: boolean
	number?: number
	browserSettings?: BrowserSettings
	chatSettings?: ChatSettings
	chatContent?: ChatContent
	mcpId?: string
	timeout?: number
	tab?: McpViewTab
	// For toggleToolAutoApprove
	serverName?: string
	serverUrl?: string
	toolNames?: string[]
	autoApprove?: boolean

	// For auth
	user?: UserInfo | null
	customToken?: string
	planActSeparateModelsSetting?: boolean
	enableCheckpointsSetting?: boolean
	mcpMarketplaceEnabled?: boolean
	telemetrySetting?: TelemetrySetting
	customInstructionsSetting?: string
	mentionsRequestId?: string
	query?: string
	// For toggleFavoriteModel
	modelId?: string
	grpc_request?: {
		service: string
		method: string
		message: any // JSON serialized protobuf message
		request_id: string // For correlating requests and responses
		is_streaming?: boolean // Whether this is a streaming request
	}
	grpc_request_cancel?: {
		request_id: string // ID of the request to cancel
	}
	// For cline rules and workflows
	isGlobal?: boolean
	rulePath?: string
	workflowPath?: string
	enabled?: boolean
	filename?: string

	payload?: { command: string; title: string }

	offset?: number
	shellIntegrationTimeout?: number
	terminalReuseEnabled?: boolean
}

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type ClineCheckpointRestore = "task" | "workspace" | "taskAndWorkspace"

export type TaskFeedbackType = "thumbs_up" | "thumbs_down"
