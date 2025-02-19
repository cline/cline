import { ApiConfiguration } from "./api"
import { HistoryItem } from "./HistoryItem"
import { GitCommit } from "../utils/git"

export type Platform = "win32" | "darwin" | "linux"

export interface ExtensionState {
	version: string
	apiConfiguration: ApiConfiguration
	customInstructions?: string
	uriScheme: string
	currentTaskItem?: HistoryItem
	checkpointTrackerErrorMessage?: string
	clineMessages: any[]
	taskHistory: HistoryItem[]
	shouldShowAnnouncement: boolean
	platform: Platform
	autoApprovalSettings: any
	browserSettings: any
	chatSettings: any
	isLoggedIn: boolean
	userInfo?: any
	commits?: GitCommit[]
	workspaceFolders?: string[]
	workspace?: string
}

export interface WorkspaceUpdateMessage {
	type: "workspaceUpdated"
	workspace: string
	workspaceFolders: string[]
}

export interface ActionMessage {
	type: "action"
	action:
		| "chatButtonClicked"
		| "mcpButtonClicked"
		| "settingsButtonClicked"
		| "historyButtonClicked"
		| "didBecomeVisible"
		| "accountLoginClicked"
		| "accountLogoutClicked"
}

export interface StateMessage {
	type: "state"
	state: ExtensionState
}

export interface ThemeMessage {
	type: "theme"
	text: string
}

export interface InvokeMessage {
	type: "invoke"
	invoke: "sendMessage" | "primaryButtonClick" | "secondaryButtonClick"
	text?: string
	images?: string[]
}

export interface SelectedImagesMessage {
	type: "selectedImages"
	images: string[]
}

export interface CommitSearchResultsMessage {
	type: "commitSearchResults"
	commits: GitCommit[]
}

export interface BrowserAction {
	type: "launch" | "click" | "type" | "scroll_down" | "scroll_up" | "close"
	url?: string
	coordinate?: string
	text?: string
}

export interface BrowserActionResult {
	success: boolean
	error?: string
	screenshot?: string
	logs?: string[]
}

export const browserActions = ["launch", "click", "type", "scroll_down", "scroll_up", "close"] as const

export interface ClineApiReqInfo {
	id: string
	model: string
	inputTokens: number
	outputTokens: number
	cacheWrites: number
	cacheReads: number
	cost: number
}

export type ClineApiReqCancelReason = "user" | "error" | "timeout"

export interface ClineAsk {
	text: string
	type: "text" | "tool" | "browser" | "mcp"
	requires_approval: boolean
}

export interface ClineAskUseMcpServer {
	text: string
	type: "mcp"
	requires_approval: boolean
	server_name: string
	tool_name: string
}

export interface ClineSay {
	text: string
	type: "text"
}

export interface ClineSayTool {
	text: string
	type: "tool"
	tool: string
	args: string[]
}

export interface ClineSayBrowserAction {
	text: string
	type: "browser"
	action: BrowserAction
}

export type ClineMessage = ClineSay | ClineSayTool | ClineSayBrowserAction | ClineAsk | ClineAskUseMcpServer

export const COMPLETION_RESULT_CHANGES_FLAG = "COMPLETION_RESULT_CHANGES"

export interface PartialMessage {
	type: "partialMessage"
	text: string
}

export interface RelinquishControl {
	type: "relinquishControl"
}

export type ExtensionMessage =
	| WorkspaceUpdateMessage
	| ActionMessage
	| StateMessage
	| ThemeMessage
	| InvokeMessage
	| SelectedImagesMessage
	| CommitSearchResultsMessage
	| PartialMessage
	| RelinquishControl
