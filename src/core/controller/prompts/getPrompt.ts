import { Controller } from "@core/controller"
import * as proto from "@shared/proto/index"
import { promptInfoToProto } from "@shared/proto-conversions/prompts/prompt-conversion"
import { systemPromptsManager } from "../../prompts/SystemPromptsManager"

export async function getPrompt(
	_controller: Controller,
	request: proto.cline.StringRequest,
): Promise<proto.cline.SystemPromptResponse> {
	const promptId = request.value
	const prompt = await systemPromptsManager.getPromptById(promptId)

	if (!prompt) {
		return proto.cline.SystemPromptResponse.create({})
	}

	return proto.cline.SystemPromptResponse.create({
		prompt: promptInfoToProto(prompt),
		content: prompt.content,
		rawContent: prompt.rawContent || "",
	})
}
