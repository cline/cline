import { Controller } from ".."
import { Empty } from "../../../shared/proto/common"
import { ResetStateRequest } from "../../../shared/proto/state"
import { resetGlobalState, resetWorkspaceState } from "../../../core/storage/state"
import { sendChatButtonClickedEvent } from "../ui/subscribeToChatButtonClicked"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/host/window"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Resets the extension state to its defaults
 * @param controller The controller instance
 * @param request The reset state request containing the global flag
 * @returns An empty response
 */
export async function resetState(controller: Controller, request: ResetStateRequest): Promise<Empty> {
	try {
		if (request.global) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Resetting global state...",
			})
			await resetGlobalState(controller.context)
		} else {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Resetting workspace state...",
			})
			await resetWorkspaceState(controller.context)
		}

		if (controller.task) {
			controller.task.abortTask()
			controller.task = undefined
		}

		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "State reset",
		})
		await controller.postStateToWebview()

		await sendChatButtonClickedEvent(controller.id)

		return Empty.create()
	} catch (error) {
		console.error("Error resetting state:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Failed to reset state: ${error instanceof Error ? error.message : String(error)}`,
		})
		throw error
	}
}
