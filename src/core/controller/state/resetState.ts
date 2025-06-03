import { Controller } from ".."
import { Empty, EmptyRequest } from "../../../shared/proto/common"
import { resetExtensionState } from "../../../core/storage/state"
import * as vscode from "vscode"
import { sendChatButtonClickedEvent } from "../ui/subscribeToChatButtonClicked"

/**
 * Resets the extension state to its defaults
 * @param controller The controller instance
 * @param request An empty request (no parameters needed)
 * @returns An empty response
 */
export async function resetState(controller: Controller, request: EmptyRequest): Promise<Empty> {
	try {
		vscode.window.showInformationMessage("Resetting state...")
		await resetExtensionState(controller.context)

		if (controller.task) {
			controller.task.abortTask()
			controller.task = undefined
		}

		vscode.window.showInformationMessage("State reset")
		await controller.postStateToWebview()

		await sendChatButtonClickedEvent(controller.id)

		return Empty.create()
	} catch (error) {
		console.error("Error resetting state:", error)
		vscode.window.showErrorMessage(`Failed to reset state: ${error instanceof Error ? error.message : String(error)}`)
		throw error
	}
}
