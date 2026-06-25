import { Empty } from "@shared/proto/cline/common"
import { AskResponseRequest } from "@shared/proto/cline/task"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
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
			Logger.warn("askResponse: No active task to receive response")
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
				Logger.warn(`askResponse: Unknown response type: ${request.responseType}`)
				return Empty.create()
		}

		if (
			responseType === "messageResponse" &&
			(request.text?.trim() || request.images.length > 0 || request.files.length > 0)
		) {
			telemetryService.capturePromptSubmitted({
				source: "ask_response_rpc",
				hasText: !!request.text?.trim(),
				hasImages: request.images.length > 0,
				hasFiles: request.files.length > 0,
				hasActiveTask: true,
				textLength: request.text?.length ?? 0,
			})
		}

		// Call the task's handler for webview responses
		await controller.task.handleWebviewAskResponse(responseType, request.text, request.images, request.files)

		return Empty.create()
	} catch (error) {
		Logger.error("Error in askResponse handler:", error)
		throw error
	}
}
