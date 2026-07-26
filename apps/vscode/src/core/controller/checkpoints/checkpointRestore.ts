import { CheckpointRestoreRequest } from "@shared/proto/bedrock_coder/checkpoints"
import { Empty } from "@shared/proto/bedrock_coder/common"
import { BedrockCoderCheckpointRestore } from "../../../shared/WebviewMessage"
import { Controller } from ".."

export async function checkpointRestore(controller: Controller, request: CheckpointRestoreRequest): Promise<Empty> {
	const sdkRestoreCheckpoint = (
		controller as Controller & {
			restoreCheckpoint?: (input: {
				checkpointRunCount: number
				restoreType: BedrockCoderCheckpointRestore
			}) => Promise<void>
		}
	).restoreCheckpoint
	if (sdkRestoreCheckpoint) {
		if (request.number) {
			await sdkRestoreCheckpoint.call(controller, {
				checkpointRunCount: Number(request.number),
				restoreType: request.restoreType as BedrockCoderCheckpointRestore,
			})
		}
		return Empty.create({})
	}

	return Empty.create({})
}
