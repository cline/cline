import { Empty } from "@shared/proto/cline/common"
import { ReorderQueuedPromptRequest } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Reorders a queued prompt to an explicit queue position for the active SDK session.
 * Used by drag-and-drop reordering of queued messages in the chat UI.
 *
 * @param controller The controller instance
 * @param request The reorder request containing the prompt ID and target position
 * @returns Empty response
 */
export async function reorderQueuedPrompt(
	controller: Controller,
	request: ReorderQueuedPromptRequest,
): Promise<Empty> {
	try {
		await controller.reorderQueuedPrompt(request.promptId, request.position)
		return Empty.create()
	} catch (error) {
		Logger.error("Error in reorderQueuedPrompt handler:", error)
		throw error
	}
}