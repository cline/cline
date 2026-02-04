import { Controller } from "@core/controller"
import * as proto from "@shared/proto/index"
import { systemPromptsManager } from "../../prompts/SystemPromptsManager"

export async function activatePrompt(
	_controller: Controller,
	request: proto.cline.StringRequest,
): Promise<proto.cline.BooleanResponse> {
	try {
		await systemPromptsManager.activatePrompt(request.value)
		return proto.cline.BooleanResponse.create({ value: true })
	} catch (error) {
		return proto.cline.BooleanResponse.create({ value: false })
	}
}
