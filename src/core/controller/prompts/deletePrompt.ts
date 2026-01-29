import { Controller } from "@core/controller"
import * as proto from "@shared/proto/index"
import { systemPromptsManager } from "../../prompts/SystemPromptsManager"

export async function deletePrompt(
	_controller: Controller,
	request: proto.cline.StringRequest,
): Promise<proto.cline.BooleanResponse> {
	const result = await systemPromptsManager.deletePrompt(request.value)
	return proto.cline.BooleanResponse.create({ value: result.success })
}
