import { Controller } from "@core/controller"
import * as proto from "@shared/proto/index"
import open from "open"
import { Logger } from "@/shared/services/Logger"
import { systemPromptsManager } from "../../prompts/SystemPromptsManager"

export async function openPromptsDirectory(
	_controller: Controller,
	_request: proto.cline.EmptyRequest,
): Promise<proto.cline.Empty> {
	const promptsDir = systemPromptsManager.getPromptsDirectory()
	await systemPromptsManager.ensurePromptsDir()

	try {
		// Open directory in system file explorer
		await open(promptsDir)
	} catch (error) {
		Logger.error("Failed to open prompts directory:", error)
	}

	return proto.cline.Empty.create({})
}
