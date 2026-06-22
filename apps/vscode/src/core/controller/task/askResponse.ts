import { Empty } from "@shared/proto/cline/common"
import { AskResponseRequest } from "@shared/proto/cline/task"
import { Controller } from ".."

/**
 * Forwards a webview ask response (button click or message continuation) to the controller.
 * @param controller The controller instance
 * @param request The ask response request (responseType + optional text/images/files)
 * @returns Empty response
 */
export async function askResponse(controller: Controller, request: AskResponseRequest): Promise<Empty> {
	await controller.askResponse(request.responseType, request.text, request.images, request.files)
	return Empty.create({})
}
