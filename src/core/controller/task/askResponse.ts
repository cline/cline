import { Empty } from "@shared/proto/cline/common"
import { AskResponseRequest } from "@shared/proto/cline/task"
import { ClineAskResponse } from "../../../shared/WebviewMessage"
import { Controller } from ".."

/**
 * Handles a response from the webview for a previous ask operation
 *
 * @param controller The controller instance
 * @param request The request containing response type, optional text and optional images
 * @returns Empty response
 */
export async function askResponse(controller: Controller, request: AskResponseRequest): Promise<Empty> {
	try {
		if (!controller.task) {
			console.warn("askResponse: No active task to receive response")
			return Empty.create()
		}

		// Map the string responseType to the ClineAskResponse enum
		let responseType: ClineAskResponse
		switch (request.responseType) {
			case "yesButtonClicked":
				responseType = "yesButtonClicked"
				break
			case "noButtonClicked":
				responseType = "noButtonClicked"
				break
			case "messageResponse":
				responseType = "messageResponse"
				break
			default:
				console.warn(`askResponse: Unknown response type: ${request.responseType}`)
				return Empty.create()
		}

		// Call the task's handler for webview responses
		await controller.task.handleWebviewAskResponse(responseType, request.text, request.images, request.files)

		return Empty.create()
	} catch (error) {
		console.error("Error in askResponse handler:", error)
		throw error
	}
}
