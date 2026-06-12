// type that represents json data that is sent from extension to webview, called ExtensionMessage and has 'type' enum which can be 'plusButtonClicked' or 'settingsButtonClicked' or 'hello'

import { WorkspaceRoot } from "@shared/multi-root/types"
import { GlobalStateAndSettings } from "@shared/storage/state-keys"
import type { Environment } from "../config"
import { AiHydroFeatureSetting } from "./AiHydroFeatureSetting"
import { AutoApprovalSettings } from "./AutoApprovalSettings"
import { AiHydroRulesToggles } from "./aihydro-rules"
import { ApiConfiguration } from "./api"
import { BrowserSettings } from "./BrowserSettings"
import { DictationSettings } from "./DictationSettings"
import { FocusChainSettings } from "./FocusChainSettings"
import { HistoryItem } from "./HistoryItem"
import { McpDisplayMode } from "./McpDisplayMode"
import { Mode, OpenaiReasoningEffort } from "./storage/types"
import { TelemetrySetting } from "./TelemetrySetting"
import { UserInfo } from "./UserInfo"
// webview will hold state
export interface ExtensionMessage {
	type: "grpc_response" | "commandResult"
	grpc_response?: GrpcResponse
	commandResult?: CommandResult
}

export type CommandResult = {
	command: string
	ok: boolean
	message?: string
	[key: string]: unknown
}

export type GrpcResponse = {
	message?: any // JSON serialized protobuf message
	request_id: string // Same ID as the request
	error?: string // Optional error message
	is_streaming?: boolean // Whether this is part of a streaming response
	sequence_number?: number // For ordering chunks in streaming responses
}

export type Platform = "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | "unknown"

export const DEFAULT_PLATFORM = "unknown"

export const COMMAND_CANCEL_TOKEN = "__aihydro_command_cancel__"

/** The ai-hydro study (research session) a chat is bound to, for the header chip. */
export interface BoundStudyInfo {
	/** Session/study id, e.g. "01547700" or "swat-usgs-01547700". */
	studyId: string
	/** Human-readable site name, when the study file records one. */
	siteName?: string
}

export interface ExtensionState {
	isNewUser: boolean
	welcomeViewCompleted: boolean
	apiConfiguration?: ApiConfiguration
	autoApprovalSettings: AutoApprovalSettings
	browserSettings: BrowserSettings
	remoteBrowserHost?: string
	preferredLanguage?: string
	openaiReasoningEffort?: OpenaiReasoningEffort
	mode: Mode
	checkpointManagerErrorMessage?: string
	aihydroMessages: AiHydroMessage[]
	currentTaskItem?: HistoryItem
	currentFocusChainChecklist?: string | null
	/**
	 * The ai-hydro study (session) this chat is currently bound to, if any.
	 * Surfaced as a chip in the task header so the user always knows which
	 * research session their conversation is operating on. Resolved from
	 * ~/.aihydro/chat_studies.json keyed by the task ulid.
	 */
	boundStudy?: BoundStudyInfo
	mcpMarketplaceEnabled?: boolean
	mcpDisplayMode: McpDisplayMode
	planActSeparateModelsSetting: boolean
	enableCheckpointsSetting?: boolean
	platform: Platform
	environment?: Environment
	shouldShowAnnouncement: boolean
	taskHistory: HistoryItem[]
	telemetrySetting: TelemetrySetting
	shellIntegrationTimeout: number
	terminalReuseEnabled?: boolean
	terminalOutputLineLimit: number
	maxConsecutiveMistakes: number
	subagentTerminalOutputLineLimit: number
	defaultTerminalProfile?: string
	vscodeTerminalExecutionMode: string
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string
	lastCompletedCommandTs?: number
	userInfo?: UserInfo
	version: string
	distinctId: string
	globalAiHydroRulesToggles: AiHydroRulesToggles
	localAiHydroRulesToggles: AiHydroRulesToggles
	localWorkflowToggles: AiHydroRulesToggles
	globalWorkflowToggles: AiHydroRulesToggles
	localCursorRulesToggles: AiHydroRulesToggles
	localWindsurfRulesToggles: AiHydroRulesToggles
	mcpResponsesCollapsed?: boolean
	strictPlanModeEnabled?: boolean
	yoloModeToggled?: boolean
	useAutoCondense?: boolean
	focusChainSettings: FocusChainSettings
	dictationSettings: DictationSettings
	customPrompt?: string
	autoCondenseThreshold?: number
	favoritedModelIds: string[]
	// NEW: Add workspace information
	workspaceRoots: WorkspaceRoot[]
	primaryRootIndex: number
	isMultiRootWorkspace: boolean
	multiRootSetting: AiHydroFeatureSetting
	lastDismissedInfoBannerVersion: number
	lastDismissedModelBannerVersion: number
	lastDismissedCliBannerVersion: number
	hooksEnabled?: AiHydroFeatureSetting
	remoteConfigSettings?: Partial<GlobalStateAndSettings>
	subagentsEnabled?: boolean
	/** Discovered workspace HTML files (path + name) for the HTML Preview file browser */
	workspaceHtmlFiles: Array<{ path: string; name: string }>
	/** Incremented whenever HTML preview items change — used as a reliable signal for the webview to refresh */
	htmlPreviewVersion: number
	/** Currently active HTML preview item ID, or null */
	htmlPreviewActiveId: string | null
}

export interface AiHydroMessage {
	ts: number
	type: "ask" | "say"
	ask?: AiHydroAsk
	say?: AiHydroSay
	text?: string
	reasoning?: string
	images?: string[]
	files?: string[]
	partial?: boolean
	commandCompleted?: boolean
	lastCheckpointHash?: string
	isCheckpointCheckedOut?: boolean
	isOperationOutsideWorkspace?: boolean
	conversationHistoryIndex?: number
	conversationHistoryDeletedRange?: [number, number] // for when conversation history is truncated for API requests
}

export type AiHydroAsk =
	| "followup"
	| "plan_mode_respond"
	| "command"
	| "command_output"
	| "completion_result"
	| "tool"
	| "api_req_failed"
	| "resume_task"
	| "resume_completed_task"
	| "mistake_limit_reached"
	| "auto_approval_max_req_reached"
	| "browser_action_launch"
	| "use_mcp_server"
	| "new_task"
	| "condense"
	| "summarize_task"
	| "report_bug"
	| "install_dependencies"
	| "workspace_env_setup"

export type AiHydroSay =
	| "task"
	| "error"
	| "error_retry"
	| "api_req_started"
	| "api_req_finished"
	| "text"
	| "reasoning"
	| "completion_result"
	| "user_feedback"
	| "user_feedback_diff"
	| "api_req_retried"
	| "command"
	| "command_output"
	| "tool"
	| "shell_integration_warning"
	| "shell_integration_warning_with_suggestion"
	| "browser_action_launch"
	| "browser_action"
	| "browser_action_result"
	| "mcp_server_request_started"
	| "mcp_server_response"
	| "mcp_notification"
	| "use_mcp_server"
	| "diff_error"
	| "deleted_api_reqs"
	| "aihydroignore_error"
	| "checkpoint_created"
	| "load_mcp_documentation"
	| "html_preview"
	| "info" // Added for general informational messages like retry status
	| "task_progress"

export interface AiHydroSayTool {
	tool:
		| "editedExistingFile"
		| "newFileCreated"
		| "readFile"
		| "listFilesTopLevel"
		| "listFilesRecursive"
		| "listCodeDefinitionNames"
		| "searchFiles"
		| "webFetch"
		| "summarizeTask"
	path?: string
	diff?: string
	content?: string
	regex?: string
	filePattern?: string
	operationIsLocatedInWorkspace?: boolean
	startLine?: number
	endLine?: number
	totalLines?: number
}

// must keep in sync with system prompt
export const browserActions = ["launch", "click", "type", "scroll_down", "scroll_up", "close"] as const
export type BrowserAction = (typeof browserActions)[number]

export interface AiHydroSayBrowserAction {
	action: BrowserAction
	coordinate?: string
	text?: string
}

export type BrowserActionResult = {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
}

export interface AiHydroAskUseMcpServer {
	serverName: string
	type: "use_mcp_tool" | "access_mcp_resource"
	toolName?: string
	arguments?: string
	uri?: string
}

export interface AiHydroPlanModeResponse {
	response: string
	options?: string[]
	selected?: string
}

export interface AiHydroAskQuestion {
	question: string
	options?: string[]
	selected?: string
}

export interface AiHydroAskNewTask {
	context: string
}

export interface AiHydroApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	cancelReason?: AiHydroApiReqCancelReason
	streamingFailedMessage?: string
	retryStatus?: {
		attempt: number
		maxAttempts: number
		delaySec: number
		errorSnippet?: string
	}
}

export type AiHydroApiReqCancelReason = "streaming_failed" | "user_cancelled" | "retries_exhausted"

export const COMPLETION_RESULT_CHANGES_FLAG = "HAS_CHANGES"
