import { Controller } from "@core/controller"
import * as proto from "@shared/proto/index"
import { promptInfoToProto } from "@shared/proto-conversions/prompts/prompt-conversion"
import { systemPromptsManager } from "../../prompts/SystemPromptsManager"

export async function listPrompts(
	_controller: Controller,
	_request: proto.cline.EmptyRequest,
): Promise<proto.cline.PromptsListResponse> {
	const prompts = await systemPromptsManager.scanPrompts(true)
	const activeId = await systemPromptsManager.getActivePromptId()
	const promptsDir = systemPromptsManager.getPromptsDirectory()

	return proto.cline.PromptsListResponse.create({
		prompts: prompts.map(promptInfoToProto),
		activePromptId: activeId,
		promptsDirectory: promptsDir,
	})
}
