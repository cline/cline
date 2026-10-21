import type { CheckpointExistsForMessageResponse } from "@shared/proto/cline/checkpoints"
import { Int64Request } from "@shared/proto/cline/common"
import { toCheckpointExistsForMessageResponse } from "@shared/proto-conversions/checkpoints/workspace-checkpoint-availability"
import { Controller } from ".."

/**
 * Reports whether Reset Code can restore the workspace from the user message
 * with the given ts, and if not, why not. The webview asks when the user
 * opens a message for editing, so the answer reflects the checkpoints that
 * exist at that moment rather than a snapshot taken when the turn ended.
 */
export async function checkpointExistsForMessage(
	controller: Controller,
	request: Int64Request,
): Promise<CheckpointExistsForMessageResponse> {
	return toCheckpointExistsForMessageResponse(await controller.getWorkspaceCheckpointAvailability(request.value))
}
