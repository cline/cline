import { Empty } from "@shared/proto/cline/common"
import { ResetStateRequest } from "@shared/proto/cline/state"
import { resetGlobalState, resetWorkspaceState } from "@/core/storage/utils/state-helpers"
import { HostProvider } from "@/hosts/host-provider"
import { t } from "@/services/i18n"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."
import { sendChatButtonClickedEvent } from "../ui/subscribeToChatButtonClicked"

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
				message: t("state.resettingGlobal"),
			})
			await resetGlobalState()
		} else {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: t("state.resettingWorkspace"),
			})
			await resetWorkspaceState()
		}

		if (controller.task) {
			controller.task.abortTask()
			controller.task = undefined
		}

		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: t("state.resetComplete"),
		})
		await controller.postStateToWebview()

		await sendChatButtonClickedEvent()

		return Empty.create()
	} catch (error) {
		Logger.error("Error resetting state:", error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: t("state.resetFailed", { error: error instanceof Error ? error.message : String(error) }),
		})
		throw error
	}
}
