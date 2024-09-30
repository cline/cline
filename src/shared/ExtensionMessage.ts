// type that represents json data that is sent from extension to webview, called ExtensionMessage and has 'type' enum which can be 'plusButtonTapped' or 'settingsButtonTapped' or 'hello'

import { ApiConfiguration } from "./api"
import { HistoryItem } from "./HistoryItem"

// webview will hold state
export interface ExtensionMessage {
	type:
		| "action"
		| "state"
		| "selectedImages"
		| "ollamaModels"
		| "theme"
		| "workspaceUpdated"
		| "invoke"
		| "partialMessage"
	text?: string
	action?: "chatButtonTapped" | "settingsButtonTapped" | "historyButtonTapped" | "didBecomeVisible"
	invoke?: "sendMessage" | "primaryButtonClick" | "secondaryButtonClick"
	state?: ExtensionState
	images?: string[]
	models?: string[]
	filePaths?: string[]
	partialMessage?: ClaudeMessage
}

export interface ExtensionState {
	version: string
	apiConfiguration?: ApiConfiguration
	customInstructions?: string
	alwaysAllowReadOnly?: boolean
	uriScheme?: string
	claudeMessages: ClaudeMessage[]
	taskHistory: HistoryItem[]
	shouldShowAnnouncement: boolean
}

export interface ClaudeMessage {
	ts: number
	type: "ask" | "say"
	ask?: ClaudeAsk
	say?: ClaudeSay
	text?: string
	images?: string[]
	partial?: boolean
}

export type ClaudeAsk =
	| "followup"
	| "command"
	| "command_output"
	| "completion_result"
	| "tool"
	| "api_req_failed"
	| "resume_task"
	| "resume_completed_task"
	| "mistake_limit_reached"

export type ClaudeSay =
	| "task"
	| "error"
	| "api_req_started"
	| "api_req_finished"
	| "text"
	| "completion_result"
	| "user_feedback"
	| "user_feedback_diff"
	| "api_req_retried"
	| "command_output"
	| "tool"
	| "shell_integration_warning"
	| "inspect_site_result"

export interface ClaudeSayTool {
	tool:
		| "editedExistingFile"
		| "newFileCreated"
		| "readFile"
		| "listFilesTopLevel"
		| "listFilesRecursive"
		| "listCodeDefinitionNames"
		| "searchFiles"
		| "inspectSite"
	path?: string
	diff?: string
	content?: string
	regex?: string
	filePattern?: string
}

export interface ClaudeApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	cancelled?: boolean
}
