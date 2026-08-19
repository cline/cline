import { EmptyRequest, Int64 } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Returns how many files changed between the latest checkpoint and the
 * current working tree (0 when nothing can be compared). The webview uses
 * this to enable the "View Changes" button on the completion row only when
 * there is something to show.
 */
export async function checkpointLatestChangesCount(controller: Controller, _request: EmptyRequest): Promise<Int64> {
	const sdkGetLatestCheckpointChangesCount = (
		controller as Controller & {
			getLatestCheckpointChangesCount?: () => Promise<number>
		}
	).getLatestCheckpointChangesCount
	if (sdkGetLatestCheckpointChangesCount) {
		return Int64.create({ value: await sdkGetLatestCheckpointChangesCount.call(controller) })
	}
	return Int64.create({ value: 0 })
}
