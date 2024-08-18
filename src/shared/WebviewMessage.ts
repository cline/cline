import { ApiConfiguration, ApiProvider } from "./api"

export interface WebviewMessage {
	type:
		| "apiConfiguration"
		| "maxRequestsPerTask"
		| "customInstructions"
		| "webviewDidLaunch"
		| "newTask"
		| "askResponse"
		| "clearTask"
		| "didShowAnnouncement"
		| "selectImages"
		| "approveReadFile"
		| "approveListFilesTopLevel"
		| "approveListFilesRecursively"		
		| "exportCurrentTask"
		| "showTaskWithId"
		| "deleteTaskWithId"
		| "exportTaskWithId"
	text?: string
	askResponse?: ClaudeAskResponse
	apiConfiguration?: ApiConfiguration
	images?: string[]
	value?: boolean  // Add this line for the new approval settings	
}

export type ClaudeAskResponse = "yesButtonTapped" | "noButtonTapped" | "messageResponse"
