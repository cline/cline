import { ApiConfiguration } from "./api"

export type WebviewMessageType =
	| "webviewDidLaunch"
	| "newTask"
	| "apiConfiguration"
	| "customInstructions"
	| "autoApprovalSettings"
	| "browserSettings"
	| "chatSettings"
	| "askResponse"
	| "clearTask"
	| "didShowAnnouncement"
	| "selectImages"
	| "exportCurrentTask"
	| "showTaskWithId"
	| "deleteTaskWithId"
	| "exportTaskWithId"
	| "resetState"
	| "openImage"
	| "openFile"
	| "openMention"
	| "checkpointDiff"
	| "checkpointRestore"
	| "taskCompletionViewChanges"
	| "cancelTask"
	| "getLatestState"
	| "accountLoginClicked"
	| "accountLogoutClicked"
	| "searchCommits"
	| "openExtensionSettings"

export interface WebviewMessage {
	type: WebviewMessageType
	text?: string
	images?: string[]
	apiConfiguration?: ApiConfiguration
	autoApprovalSettings?: any
	browserSettings?: any
	chatSettings?: any
	chatContent?: {
		message?: string
		images?: string[]
	}
	askResponse?: ClineAskResponse
	number?: number
}

export interface ClineAskResponse {
	text: string
	images?: string[]
}

export interface ClineCheckpointRestore {
	checkpointNumber: number
	restoreMode: "task" | "workspace" | "taskAndWorkspace"
}

export interface ChatSettings {
	mode: "act" | "plan"
	autoScroll: boolean
	showTimestamps: boolean
	showCheckpoints: boolean
	showDiffs: boolean
	showLineNumbers: boolean
	showGutter: boolean
	showMinimap: boolean
	showIndentGuides: boolean
	showInvisibles: boolean
	wordWrap: boolean
	theme: string
	fontSize: number
	lineHeight: number
	fontFamily: string
	tabSize: number
	useSoftTabs: boolean
	useSpaces: boolean
	trimTrailingWhitespace: boolean
	insertFinalNewline: boolean
	trimFinalNewlines: boolean
}

export interface AutoApprovalSettings {
	enabled: boolean
	tools: string[]
}
