import { Controller } from "@core/controller"
import * as proto from "@shared/proto/index"
import { systemPromptsManager } from "../../prompts/SystemPromptsManager"

export async function getActivePromptId(
	_controller: Controller,
	_request: proto.cline.EmptyRequest,
): Promise<proto.cline.String> {
	const activeId = await systemPromptsManager.getActivePromptId()
	return proto.cline.String.create({ value: activeId })
}
