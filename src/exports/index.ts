import * as vscode from "vscode"
import { Controller } from "@core/controller"
import { ClineAPI } from "./cline"
import { getGlobalState } from "@core/storage/state"
import { TaskServiceClient } from "webview-ui/src/services/grpc-client"

export function createClineAPI(outputChannel: vscode.OutputChannel, sidebarController: Controller): ClineAPI {
	const api: ClineAPI = {
		setCustomInstructions: async (value: string) => {
			await sidebarController.updateCustomInstructions(value)
			outputChannel.appendLine("Custom instructions set")
		},

		getCustomInstructions: async () => {
			return (await getGlobalState(sidebarController.context, "customInstructions")) as string | undefined
		},

		startNewTask: async (task?: string, images?: string[]) => {
			outputChannel.appendLine("Starting new task")
			await sidebarController.clearTask()
			await sidebarController.postStateToWebview()
			await sidebarController.postMessageToWebview({
				type: "action",
				action: "chatButtonClicked",
			})
			await TaskServiceClient.invoke({
				action: "sendMessage",
				text: task || "",
				images: images || [],
			})
			outputChannel.appendLine(
				`Task started with message: ${task ? `"${task}"` : "undefined"} and ${images?.length || 0} image(s)`,
			)
		},

		sendMessage: async (message?: string, images?: string[]) => {
			outputChannel.appendLine(
				`Sending message: ${message ? `"${message}"` : "undefined"} with ${images?.length || 0} image(s)`,
			)
			await TaskServiceClient.invoke({
				action: "sendMessage",
				text: message || "",
				images: images || [],
			})
		},

		pressPrimaryButton: async () => {
			outputChannel.appendLine("Pressing primary button")
			await TaskServiceClient.invoke({
				action: "primaryButtonClick",
				text: "",
				images: [],
			})
		},

		pressSecondaryButton: async () => {
			outputChannel.appendLine("Pressing secondary button")
			await TaskServiceClient.invoke({
				action: "secondaryButtonClick",
				text: "",
				images: [],
			})
		},
	}

	return api
}
