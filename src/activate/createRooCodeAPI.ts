import * as vscode from "vscode"

import { ClineProvider } from "../core/webview/ClineProvider"

import { RooCodeAPI } from "../exports/roo-code"
import { ConfigurationValues } from "../shared/globalState"

export function createRooCodeAPI(outputChannel: vscode.OutputChannel, provider: ClineProvider): RooCodeAPI {
	return {
		startNewTask: async (task?: string, images?: string[]) => {
			outputChannel.appendLine("Starting new task")

			await provider.removeClineFromStack()
			await provider.postStateToWebview()
			await provider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })

			await provider.postMessageToWebview({
				type: "invoke",
				invoke: "sendMessage",
				text: task,
				images: images,
			})

			outputChannel.appendLine(
				`Task started with message: ${task ? `"${task}"` : "undefined"} and ${images?.length || 0} image(s)`,
			)
		},

		cancelTask: async () => {
			outputChannel.appendLine("Cancelling current task")
			await provider.cancelTask()
		},

		sendMessage: async (message?: string, images?: string[]) => {
			outputChannel.appendLine(
				`Sending message: ${message ? `"${message}"` : "undefined"} with ${images?.length || 0} image(s)`,
			)

			await provider.postMessageToWebview({
				type: "invoke",
				invoke: "sendMessage",
				text: message,
				images: images,
			})
		},

		pressPrimaryButton: async () => {
			outputChannel.appendLine("Pressing primary button")
			await provider.postMessageToWebview({ type: "invoke", invoke: "primaryButtonClick" })
		},

		pressSecondaryButton: async () => {
			outputChannel.appendLine("Pressing secondary button")
			await provider.postMessageToWebview({ type: "invoke", invoke: "secondaryButtonClick" })
		},

		setConfiguration: async (values: Partial<ConfigurationValues>) => {
			await provider.setValues(values)
		},

		isReady: () => provider.viewLaunched,

		getMessages: () => provider.messages,
	}
}
