import { Controller } from ".."
import { StringRequest, Empty } from "../../../shared/proto/common"

/**
 * Report bug slash command logic
 */
export async function reportBug(controller: Controller, request: StringRequest): Promise<Empty> {
	await controller.task?.handleWebviewAskResponse("yesButtonClicked")
	return Empty.create()
}
