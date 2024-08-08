import { ApiConfiguration, ApiProvider } from "./api"

export interface WebviewMessage {
	type:
		| "apiConfiguration"
		| "maxRequestsPerTask"
		| "webviewDidLaunch"
		| "newTask"
		| "askResponse"
		| "clearTask"
		| "didShowAnnouncement"
		| "downloadTask"
		| "selectImages"
		| "processPastedImages"
	text?: string
	askResponse?: ClaudeAskResponse
	apiConfiguration?: ApiConfiguration
	images?: string[]
}

export type ClaudeAskResponse = "yesButtonTapped" | "noButtonTapped" | "messageResponse"
