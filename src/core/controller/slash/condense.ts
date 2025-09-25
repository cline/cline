import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Command slash command logic
 */
export async function condense(controller: Controller, _request: StringRequest): Promise<Empty> {
	await controller.task?.handleWebviewAskResponse("yesButtonClicked")
	return Empty.create()
}
