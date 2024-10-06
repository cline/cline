import * as vscode from "vscode"
import { ClineProvider } from "../core/webview/ClaudeDevProvider"
import { ClaudeDevAPI } from "./claude-dev"

export function createClaudeDevAPI(outputChannel: vscode.OutputChannel, sidebarProvider: ClineProvider): ClaudeDevAPI {
	const api: ClaudeDevAPI = {
		setCustomInstructions: async (value: string) => {
			await sidebarProvider.updateCustomInstructions(value)
			outputChannel.appendLine("Custom instructions set")
		},

		getCustomInstructions: async () => {
			return (await sidebarProvider.getGlobalState("customInstructions")) as string | undefined
		},

		startNewTask: async (task?: string, images?: string[]) => {
			outputChannel.appendLine("Starting new task")
			await sidebarProvider.clearTask()
			await sidebarProvider.postStateToWebview()
			await sidebarProvider.postMessageToWebview({ type: "action", action: "chatButtonTapped" })
			await sidebarProvider.postMessageToWebview({
				type: "invoke",
				invoke: "sendMessage",
				text: task,
				images: images,
			})
			outputChannel.appendLine(
				`Task started with message: ${task ? `"${task}"` : "undefined"} and ${images?.length || 0} image(s)`
			)
		},

		sendMessage: async (message?: string, images?: string[]) => {
			outputChannel.appendLine(
				`Sending message: ${message ? `"${message}"` : "undefined"} with ${images?.length || 0} image(s)`
			)
			await sidebarProvider.postMessageToWebview({
				type: "invoke",
				invoke: "sendMessage",
				text: message,
				images: images,
			})
		},

		pressPrimaryButton: async () => {
			outputChannel.appendLine("Pressing primary button")
			await sidebarProvider.postMessageToWebview({
				type: "invoke",
				invoke: "primaryButtonClick",
			})
		},

		pressSecondaryButton: async () => {
			outputChannel.appendLine("Pressing secondary button")
			await sidebarProvider.postMessageToWebview({
				type: "invoke",
				invoke: "secondaryButtonClick",
			})
		},
	}

	return api
}
