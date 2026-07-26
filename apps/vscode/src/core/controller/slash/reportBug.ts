import { Empty, StringRequest } from "@shared/proto/bedrock_coder/common"
import { Controller } from ".."

/**
 * Report bug slash command logic
 */
export async function reportBug(controller: Controller, _request: StringRequest): Promise<Empty> {
	await controller.task?.handleWebviewAskResponse("yesButtonClicked")
	return Empty.create()
}
