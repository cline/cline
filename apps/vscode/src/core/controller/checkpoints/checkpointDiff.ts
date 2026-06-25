import { Empty, Int64Request } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function checkpointDiff(controller: Controller, request: Int64Request): Promise<Empty> {
	const sdkCompareCheckpoint = (
		controller as Controller & {
			compareCheckpoint?: (input: { checkpointRunCount: number }) => Promise<void>
		}
	).compareCheckpoint
	if (sdkCompareCheckpoint && request.value) {
		await sdkCompareCheckpoint.call(controller, {
			checkpointRunCount: Number(request.value),
		})
	}
	return Empty.create()
}
