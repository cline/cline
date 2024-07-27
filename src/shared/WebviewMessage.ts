export interface WebviewMessage {
	type:
		| "webviewDidLaunch"
		| "newTask"
		| "loadTask"
		| "apiKey"
		| "maxRequestsPerTask"
		| "askResponse"
		| "clearTask"
		| "viewTaskHistory"
		| "clearTaskHistory"
	text?: string
	taskId?: string
	askResponse?: ClaudeAskResponse
}
export type ClaudeAskResponse = "yesButtonTapped" | "noButtonTapped" | "textResponse"
