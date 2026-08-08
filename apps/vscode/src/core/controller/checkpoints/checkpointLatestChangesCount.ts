import { CheckpointLatestChanges } from "@shared/proto/cline/checkpoints"
import { EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Returns how many files changed between the latest checkpoint and the
 * current working tree, and whether a checkpoint exists to compare against
 * at all. The webview uses the count to enable the "View Changes" button on
 * the completion row only when there is something to show, and uses
 * hasCheckpoint to explain WHY the button is disabled: "no file changes" vs
 * "checkpoints unavailable" (non-git workspace, no commits, or a comparison
 * failure).
 */
export async function checkpointLatestChangesCount(
	controller: Controller,
	_request: EmptyRequest,
): Promise<CheckpointLatestChanges> {
	const sdkGetLatestCheckpointChangesCount = (
		controller as Controller & {
			getLatestCheckpointChangesCount?: () => Promise<{ count: number; hasCheckpoint: boolean }>
		}
	).getLatestCheckpointChangesCount
	if (sdkGetLatestCheckpointChangesCount) {
		const { count, hasCheckpoint } = await sdkGetLatestCheckpointChangesCount.call(controller)
		return CheckpointLatestChanges.create({ count, hasCheckpoint })
	}
	return CheckpointLatestChanges.create({ count: 0, hasCheckpoint: false })
}
