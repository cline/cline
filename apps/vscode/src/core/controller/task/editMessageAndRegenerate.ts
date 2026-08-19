import { Empty } from "@shared/proto/cline/common"
import { EditMessageAndRegenerateRequest } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Edits a previous user message, truncates the conversation after that point,
 * and starts a fresh turn from the edited message.
 */
export async function editMessageAndRegenerate(controller: Controller, request: EditMessageAndRegenerateRequest): Promise<Empty> {
	try {
		await controller.editMessageAndRegenerate({
			messageTs: request.messageTs,
			text: request.text,
			images: request.images,
			files: request.files,
			restoreWorkspace: request.restoreWorkspace,
		})
		return Empty.create({})
	} catch (error) {
		Logger.error("Error in editMessageAndRegenerate handler:", error)
		throw error
	}
}
