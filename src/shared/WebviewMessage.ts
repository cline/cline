import { ApiConfiguration } from "./api"
import { AutoApprovalSettings } from "./AutoApprovalSettings"
import { BrowserSettings } from "./BrowserSettings"
import { ChatSettings } from "./ChatSettings"
import { UserInfo } from "./UserInfo"
import { ChatContent } from "./ChatContent"
import { TelemetrySetting } from "./TelemetrySetting"

export interface WebviewMessage {
	type:
		| "apiConfiguration"
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
		| "openInBrowser"
		| "openFile"
		| "openMention"
		| "cancelTask"
		| "refreshOpenRouterModels"
		| "refreshOpenAiModels"
		| "openMcpSettings"
		| "restartMcpServer"
		| "deleteMcpServer"
		| "autoApprovalSettings"
		| "browserSettings"
		| "togglePlanActMode"
		| "checkpointDiff"
		| "checkpointRestore"
		| "taskCompletionViewChanges"
		| "openExtensionSettings"
		| "requestVsCodeLmModels"
		| "toggleToolAutoApprove"
		| "toggleMcpServer"
		| "getLatestState"
		| "accountLoginClicked"
		| "accountLogoutClicked"
		| "authStateChanged"
		| "authCallback"
		| "fetchMcpMarketplace"
		| "downloadMcp"
		| "silentlyRefreshMcpMarketplace"
		| "searchCommits"
		| "showMcpView"
		| "fetchLatestMcpServersFromHub"
		| "telemetrySetting"
		| "openSettings"
		| "updateMcpTimeout"
		| "fetchOpenGraphData"
		| "checkIsImageUrl"
		| "invoke"
		| "updateSettings"
		| "clearAllTaskHistory"
	// | "relaunchChromeDebugMode"
	text?: string
	disabled?: boolean
	askResponse?: ClineAskResponse
	apiConfiguration?: ApiConfiguration
	images?: string[]
	bool?: boolean
	number?: number
	autoApprovalSettings?: AutoApprovalSettings
	browserSettings?: BrowserSettings
	chatSettings?: ChatSettings
	chatContent?: ChatContent
	mcpId?: string
	timeout?: number
	// For toggleToolAutoApprove
	serverName?: string
	toolName?: string
	autoApprove?: boolean

	// For auth
	user?: UserInfo | null
	customToken?: string
	// For openInBrowser
	url?: string
	planActSeparateModelsSetting?: boolean
	telemetrySetting?: TelemetrySetting
	customInstructionsSetting?: string
}

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type ClineCheckpointRestore = "task" | "workspace" | "taskAndWorkspace"
