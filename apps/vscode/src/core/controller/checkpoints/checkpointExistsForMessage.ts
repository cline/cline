import { CheckpointExistsForMessageResponse, CheckpointUnavailableReason } from "@shared/proto/cline/checkpoints"
import { Int64Request } from "@shared/proto/cline/common"
import { Controller } from ".."

const REASON_BY_NAME = {
	checkpoints_disabled: CheckpointUnavailableReason.CHECKPOINT_UNAVAILABLE_REASON_CHECKPOINTS_DISABLED,
	no_git_repository: CheckpointUnavailableReason.CHECKPOINT_UNAVAILABLE_REASON_NO_GIT_REPOSITORY,
	checkpoint_failed: CheckpointUnavailableReason.CHECKPOINT_UNAVAILABLE_REASON_CHECKPOINT_FAILED,
	checkpoint_unavailable: CheckpointUnavailableReason.CHECKPOINT_UNAVAILABLE_REASON_CHECKPOINT_UNAVAILABLE,
} as const

/**
 * Reports whether Reset Code can restore the workspace from the user message
 * with the given ts — and if not, why not, so the webview can explain it
 * instead of showing one generic tooltip. The webview asks when the user
 * opens a message for editing, so the answer reflects the checkpoints that
 * exist at that moment rather than a snapshot taken when the turn ended.
 */
export async function checkpointExistsForMessage(
	controller: Controller,
	request: Int64Request,
): Promise<CheckpointExistsForMessageResponse> {
	const result = await controller.hasWorkspaceCheckpointForMessage(request.value)
	return CheckpointExistsForMessageResponse.create({
		exists: result.exists,
		reason: result.exists
			? CheckpointUnavailableReason.CHECKPOINT_UNAVAILABLE_REASON_UNSPECIFIED
			: REASON_BY_NAME[result.reason],
	})
}
