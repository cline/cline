// type that represents json data that is sent from extension to webview, called ExtensionMessage and has 'type' enum which can be 'plusButtonTapped' or 'settingsButtonTapped' or 'hello'

// webview will hold state
export interface ExtensionMessage {
    type: "text" | "action"
    text?: string
    action?: "plusButtonTapped" | "settingsButtonTapped"
}