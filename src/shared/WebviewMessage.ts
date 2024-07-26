export interface WebviewMessage {
	type:
		| "apiKey"
		| "maxRequestsPerTask"
		| "webviewDidLaunch"
		| "newTask"
		| "askResponse"
		| "clearTask"
		| "didShowAnnouncement"
	text?: string
	askResponse?: ClaudeAskResponse
}

export type ClaudeAskResponse = "yesButtonTapped" | "noButtonTapped" | "textResponse"
