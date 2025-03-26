import { ApiConfiguration } from "./api"
import { AutoApprovalSettings } from "./AutoApprovalSettings"
import { BrowserSettings } from "./BrowserSettings"
import { ChatSettings } from "./ChatSettings"
import { UserInfo } from "./UserInfo"
import { ChatContent } from "./ChatContent"
import { TelemetrySetting } from "./TelemetrySetting"

// Interfaces for machine-actionable advice
export interface CodeSuggestion {
  file: string;
  location?: { line: number; column: number };
  currentCode?: string;
  suggestedCode?: string;
  explanation: string;
}

export interface MachineData {
  actionType: 'code_suggestion' | 'refactor_advice' | 'security_warning' | 'performance_tip' | 'best_practice' | string;
  context: string;
  suggestions?: CodeSuggestion[];
  metadata?: Record<string, any>;
}

export interface ExternalAdvice {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'warning' | 'tip' | 'task';
  priority: 'low' | 'medium' | 'high';
  timestamp: number;
  expiresAt: number | null;
  relatedFiles: string[];
  read: boolean;
  dismissed?: boolean;
  machineData?: MachineData;
}

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
		| "showAccountViewClicked"
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
		| "fetchUserCreditsData"
		| "optionsResponse"
		| "requestTotalTasksSize"
		| "toggleActiveConversation"
		| "getExternalAdvice"
		| "markAdviceAsRead"
		| "dismissAdvice"
		| "restoreAdvice"
		| "sendExternalAdviceToChat"
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
	
	// For external advice
	advice?: ExternalAdvice
	adviceId?: string
}

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type ClineCheckpointRestore = "task" | "workspace" | "taskAndWorkspace"
