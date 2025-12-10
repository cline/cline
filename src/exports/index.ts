import { Controller } from "@core/controller"
import { sendChatButtonClickedEvent } from "@core/controller/ui/subscribeToChatButtonClicked"
import { HostProvider } from "@/hosts/host-provider"
import { ClineAPI } from "./cline"

export function createClineAPI(sidebarController: Controller): ClineAPI {
	const api: ClineAPI = {
		startNewTask: async (task?: string, images?: string[]) => {
			HostProvider.get().logToChannel("Starting new task")
			await sidebarController.clearTask()
			await sidebarController.postStateToWebview()

			await sendChatButtonClickedEvent()
			await sidebarController.initTask(task, images)
			HostProvider.get().logToChannel(
				`Task started with message: ${task ? `"${task}"` : "undefined"} and ${images?.length || 0} image(s)`,
			)
		},

		sendMessage: async (message?: string, images?: string[]) => {
			HostProvider.get().logToChannel(
				`Sending message: ${message ? `"${message}"` : "undefined"} with ${images?.length || 0} image(s)`,
			)
			if (sidebarController.task) {
				await sidebarController.task.handleWebviewAskResponse("messageResponse", message || "", images || [])
			} else {
				HostProvider.get().logToChannel("No active task to send message to")
			}
		},

		pressPrimaryButton: async () => {
			HostProvider.get().logToChannel("Pressing primary button")
			if (sidebarController.task) {
				await sidebarController.task.handleWebviewAskResponse("yesButtonClicked", "", [])
			} else {
				HostProvider.get().logToChannel("No active task to press button for")
			}
		},

		pressSecondaryButton: async () => {
			HostProvider.get().logToChannel("Pressing secondary button")
			if (sidebarController.task) {
				await sidebarController.task.handleWebviewAskResponse("noButtonClicked", "", [])
			} else {
				HostProvider.get().logToChannel("No active task to press button for")
			}
		},
	}

	return api
}
