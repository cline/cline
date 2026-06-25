import { CheckpointRestoreRequest } from "@shared/proto/cline/checkpoints"
import { Empty } from "@shared/proto/cline/common"
import { ClineCheckpointRestore } from "../../../shared/WebviewMessage"
import { Controller } from ".."

export async function checkpointRestore(controller: Controller, request: CheckpointRestoreRequest): Promise<Empty> {
	const sdkRestoreCheckpoint = (
		controller as Controller & {
			restoreCheckpoint?: (input: { checkpointRunCount: number; restoreType: ClineCheckpointRestore }) => Promise<void>
		}
	).restoreCheckpoint
	if (sdkRestoreCheckpoint) {
		if (request.number) {
			await sdkRestoreCheckpoint.call(controller, {
				checkpointRunCount: Number(request.number),
				restoreType: request.restoreType as ClineCheckpointRestore,
			})
		}
		return Empty.create({})
	}

	return Empty.create({})
}
