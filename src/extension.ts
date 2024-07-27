// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode"
import { SidebarProvider } from "./providers/SidebarProvider"
import { TaskHistoryManager } from "./TaskHistoryManager"

/*
Built using https://github.com/microsoft/vscode-webview-ui-toolkit

Inspired by
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra

*/

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const provider = new SidebarProvider(context)

	context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, provider))

	context.subscriptions.push(
		vscode.commands.registerCommand("claude-dev.plusButtonTapped", async () => {
			await provider.clearTask()
			await provider.postStateToWebview()
			await provider.postMessageToWebview({ type: "action", action: "plusButtonTapped" })
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("claude-dev.settingsButtonTapped", () => {
			provider.postMessageToWebview({ type: "action", action: "settingsButtonTapped" })
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("claude-dev.showTaskHistory", () => {
			provider.postMessageToWebview({ type: "action", action: "viewTaskHistory" })
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("claude-dev.clearTaskHistory", () => {
			const taskHistoryManager = new TaskHistoryManager(context)
			taskHistoryManager.clearHistory()
			vscode.window.showInformationMessage("Task history cleared")
			provider.postMessageToWebview({ type: "action", action: "taskHistoryCleared" })
		})
	)
}

// This method is called when your extension is deactivated
export function deactivate() {}
