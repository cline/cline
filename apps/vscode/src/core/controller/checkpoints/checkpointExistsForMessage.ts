import { Boolean, Int64Request } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Reports whether Reset Code can restore the workspace from the user message
 * with the given ts. The webview asks when the user opens a message for
 * editing, so the answer reflects the checkpoints that exist at that moment
 * rather than a snapshot taken when the turn ended.
 */
export async function checkpointExistsForMessage(controller: Controller, request: Int64Request): Promise<Boolean> {
	return Boolean.create({ value: await controller.hasWorkspaceCheckpointForMessage(request.value) })
}
