import { Controller } from "@core/controller"
import * as proto from "@shared/proto/index"
import { protoToMetadata } from "@shared/proto-conversions/prompts/prompt-conversion"
import { systemPromptsManager } from "../../prompts/SystemPromptsManager"

export async function createPrompt(
	_controller: Controller,
	request: proto.cline.CreatePromptRequest,
): Promise<proto.cline.CreatePromptResponse> {
	const metadata = protoToMetadata(request.metadata)

	if (request.description) {
		metadata.description = request.description
	}

	const result = await systemPromptsManager.createPrompt(request.name, request.content, metadata)

	return proto.cline.CreatePromptResponse.create({
		success: result.success,
		id: result.id,
		error: result.error,
	})
}
