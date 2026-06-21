import { CheckpointRestoreRequest } from "@shared/proto/cline/checkpoints"
import { Empty } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function checkpointRestore(_controller: Controller, _request: CheckpointRestoreRequest): Promise<Empty> {
	return Empty.create({})
}
