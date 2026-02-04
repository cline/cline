import { Controller } from "@core/controller"
import * as proto from "@shared/proto/index"
import { systemPromptsManager } from "../../prompts/SystemPromptsManager"

export async function updatePrompt(
	_controller: Controller,
	request: proto.cline.UpdatePromptRequest,
): Promise<proto.cline.BooleanResponse> {
	const result = await systemPromptsManager.updatePrompt(request.id, request.content)
	return proto.cline.BooleanResponse.create({ value: result.success })
}
