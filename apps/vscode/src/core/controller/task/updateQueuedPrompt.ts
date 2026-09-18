import { Empty } from "@shared/proto/cline/common"
import { UpdateQueuedPromptRequest } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Updates a queued prompt's content (and optionally delivery) for the active SDK session.
 *
 * @param controller The controller instance
 * @param request The update request containing the prompt ID and optional new content
 * @returns Empty response
 */
export async function updateQueuedPrompt(
	controller: Controller,
	request: UpdateQueuedPromptRequest,
): Promise<Empty> {
	try {
		await controller.updateQueuedPrompt({
			promptId: request.promptId,
			prompt: request.prompt ?? undefined,
			delivery: request.delivery ?? undefined,
		})
		return Empty.create()
	} catch (error) {
		Logger.error("Error in updateQueuedPrompt handler:", error)
		throw error
	}
}