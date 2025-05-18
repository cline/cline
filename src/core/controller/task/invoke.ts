import { Controller } from ".."
import { Empty } from "../../../shared/proto/common"
import { InvokeRequest } from "../../../shared/proto/task"
import { Invoke } from "../../../shared/ExtensionMessage"

/**
 * Directly handles invoke actions in the Controller
 *
 * This is a replacement for the old VSCode message-based invoke system.
 * Instead of sending a message back to the webview, we directly handle
 * the action in the Controller.
 *
 * @param controller The controller instance
 * @param request The request containing action type, optional text and optional images
 * @returns Empty response
 */
export async function invoke(controller: Controller, request: InvokeRequest): Promise<Empty> {
	try {
		// Validate action is one of the allowed Invoke types
		const action = request.action as Invoke
		if (!["sendMessage", "primaryButtonClick", "secondaryButtonClick"].includes(action)) {
			console.warn(`invoke: Invalid action type: ${request.action}`)
			return Empty.create()
		}

		// Handle the action directly
		switch (action) {
			case "sendMessage":
				if (controller.task?.isAwaitingPlanResponse) {
					// Handle the special case for plan mode toggle
					controller.task.didRespondToPlanAskBySwitchingMode = true
				}

				// If there's an active task and it's waiting for response
				if (controller.task) {
					await controller.task.handleWebviewAskResponse("messageResponse", request.text || "", request.images || [])
				}
				break

			case "primaryButtonClick":
				if (controller.task) {
					await controller.task.handleWebviewAskResponse("yesButtonClicked", request.text || "", request.images || [])
				}
				break

			case "secondaryButtonClick":
				if (controller.task) {
					await controller.task.handleWebviewAskResponse("noButtonClicked", request.text || "", request.images || [])
				}
				break
		}

		return Empty.create()
	} catch (error) {
		console.error("Error in invoke handler:", error)
		throw error
	}
}
