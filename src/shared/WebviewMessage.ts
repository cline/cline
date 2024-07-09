export interface WebviewMessage {
    type: "apiKey" | "maxRequestsPerTask" | "webviewDidLaunch" | "newTask" | "askResponse" | "abortTask"
    text?: string
    askResponse?: ClaudeAskResponse
}

export type ClaudeAskResponse = "newTaskButtonTapped" | "yesButtonTapped" | "noButtonTapped" | "textResponse"