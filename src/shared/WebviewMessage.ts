export interface WebviewMessage {
    type: "text" | "action"
    text?: string
    action?: "newTaskButtonTapped" | "yesButtonTapped" | "noButtonTapped" | "executeButtonTapped"
}