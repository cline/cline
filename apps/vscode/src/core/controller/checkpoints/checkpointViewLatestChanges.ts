import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Opens a multi-file diff of everything that changed between the latest
 * checkpoint (snapshotted when the user's last message started a run) and the
 * current working tree ("View Changes" on the completion row).
 */
export async function checkpointViewLatestChanges(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const sdkViewLatestCheckpointChanges = (
		controller as Controller & {
			viewLatestCheckpointChanges?: () => Promise<void>
		}
	).viewLatestCheckpointChanges
	if (sdkViewLatestCheckpointChanges) {
		await sdkViewLatestCheckpointChanges.call(controller)
	}
	return Empty.create({})
}
