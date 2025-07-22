import { Controller } from ".."
import { StringRequest, Empty } from "@shared/proto/cline/common"

/**
 * Command slash command logic
 */
export async function condense(controller: Controller, request: StringRequest): Promise<Empty> {
	await controller.task?.handleWebviewAskResponse("yesButtonClicked")
	return Empty.create()
}
