// type that represents json data that is sent from extension to webview, called ExtensionMessage and has 'type' enum which can be 'plusButtonTapped' or 'settingsButtonTapped' or 'hello'

import { ApiConfiguration } from "./api"
import { HistoryItem } from "./HistoryItem"

// webview will hold state
export interface ExtensionMessage {
	type: "action" | "state" | "selectedImages"
	text?: string
	action?:
		| "chatButtonTapped"
		| "settingsButtonTapped"
		| "historyButtonTapped"
		| "didBecomeVisible"
		| "koduAuthenticated"
		| "koduCreditsFetched"
	state?: ExtensionState
	images?: string[]
}

export interface ExtensionState {
	version: string
	apiConfiguration?: ApiConfiguration
	maxRequestsPerTask?: number
	customInstructions?: string
	alwaysAllowReadOnly?: boolean
	themeName?: string
	claudeMessages: ClaudeMessage[]
	taskHistory: HistoryItem[]
	shouldShowAnnouncement: boolean
	koduCredits?: number
}

export interface ClaudeMessage {
	ts: number
	type: "ask" | "say"
	ask?: ClaudeAsk
	say?: ClaudeSay
	text?: string
	images?: string[]
}

export type ClaudeAsk =
	| "request_limit_reached"
	| "followup"
	| "command"
	| "command_output"
	| "completion_result"
	| "tool"
	| "api_req_failed"
	| "resume_task"
	| "resume_completed_task"

export type ClaudeSay =
	| "task"
	| "error"
	| "api_req_started"
	| "api_req_finished"
	| "text"
	| "completion_result"
	| "user_feedback"
	| "api_req_retried"
	| "command_output"
	| "tool"

export interface ClaudeSayTool {
	tool:
		| "editedExistingFile"
		| "newFileCreated"
		| "readFile"
		| "listFilesTopLevel"
		| "listFilesRecursive"
		| "viewSourceCodeDefinitionsTopLevel"
	path?: string
	diff?: string
	content?: string
}
