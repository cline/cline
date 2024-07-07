export interface WebviewMessage {
    type: "text" | "action" | "apiKey" | "maxRequestsPerTask" | "webviewDidLaunch"
    text?: string
    action?: "newTaskButtonTapped" | "yesButtonTapped" | "noButtonTapped" | "executeButtonTapped"
}