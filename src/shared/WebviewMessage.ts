import { ApiConfiguration } from "./api"
import { AutoApprovalSettings } from "./AutoApprovalSettings"
import { BrowserSettings } from "./BrowserSettings"
import { McpMode } from "./mcp"

export interface WebviewMessage {
	type:
		| "apiConfiguration"
		| "customInstructions"
		| "webviewDidLaunch"
		| "newTask"
		| "askResponse"
		| "clearTask"
		| "didShowAnnouncement"
		| "selectImages"
		| "exportCurrentTask"
		| "showTaskWithId"
		| "deleteTaskWithId"
		| "exportTaskWithId"
		| "resetState"
		| "requestOllamaModels"
		| "requestLmStudioModels"
		| "openImage"
		| "openFile"
		| "openMention"
		| "cancelTask"
		| "refreshOpenRouterModels"
		| "openMcpSettings"
		| "restartMcpServer"
		| "autoApprovalSettings"
		| "browserSettings"
		| "checkpointDiff"
		| "checkpointRestore"
		| "taskCompletionViewChanges"
		| "openExtensionSettings"
		| "getMcpEnabled"
		| "toggleMcp"
	text?: string
	askResponse?: ClineAskResponse
	apiConfiguration?: ApiConfiguration
	images?: string[]
	bool?: boolean
	number?: number
	autoApprovalSettings?: AutoApprovalSettings
	browserSettings?: BrowserSettings
	mode?: McpMode // Only used with toggleMcp type
}

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type ClineCheckpointRestore = "task" | "workspace" | "taskAndWorkspace"
