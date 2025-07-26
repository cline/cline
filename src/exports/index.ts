import * as vscode from "vscode"
import { Controller } from "@core/controller"
import { ClineAPI } from "./cline"
import { getGlobalState } from "@core/storage/state"
import { sendChatButtonClickedEvent } from "@core/controller/ui/subscribeToChatButtonClicked"
import { WebviewProviderType as WebviewProviderTypeEnum } from "@shared/proto/cline/ui"

export function createClineAPI(outputChannel: vscode.OutputChannel, sidebarController: Controller): ClineAPI {
	const api: ClineAPI = {
		startNewTask: async (task?: string, images?: string[]) => {
			outputChannel.appendLine("Starting new task")
			await sidebarController.clearTask()
			await sidebarController.postStateToWebview()

			await sendChatButtonClickedEvent(sidebarController.id)
			await sidebarController.initTask(task, images)
			outputChannel.appendLine(
				`Task started with message: ${task ? `"${task}"` : "undefined"} and ${images?.length || 0} image(s)`,
			)
		},

		sendMessage: async (message?: string, images?: string[]) => {
			outputChannel.appendLine(
				`Sending message: ${message ? `"${message}"` : "undefined"} with ${images?.length || 0} image(s)`,
			)
			if (sidebarController.task) {
				await sidebarController.task.handleWebviewAskResponse("messageResponse", message || "", images || [])
			} else {
				outputChannel.appendLine("No active task to send message to")
			}
		},

		pressPrimaryButton: async () => {
			outputChannel.appendLine("Pressing primary button")
			if (sidebarController.task) {
				await sidebarController.task.handleWebviewAskResponse("yesButtonClicked", "", [])
			} else {
				outputChannel.appendLine("No active task to press button for")
			}
		},

		pressSecondaryButton: async () => {
			outputChannel.appendLine("Pressing secondary button")
			if (sidebarController.task) {
				await sidebarController.task.handleWebviewAskResponse("noButtonClicked", "", [])
			} else {
				outputChannel.appendLine("No active task to press button for")
			}
		},
	}

	return api
}
