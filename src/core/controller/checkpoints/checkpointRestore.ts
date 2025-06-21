import { Controller } from ".."
import { ClineCheckpointRestore } from "../../../shared/WebviewMessage"
import { CheckpointRestoreRequest } from "../../../shared/proto/checkpoints"
import { Empty } from "../../../shared/proto/common"
import pWaitFor from "p-wait-for"

export async function checkpointRestore(controller: Controller, request: CheckpointRestoreRequest): Promise<Empty> {
	await controller.cancelTask() // we cannot alter message history say if the task is active, as it could be in the middle of editing a file or running a command, which expect the ask to be responded to rather than being superseded by a new message eg add deleted_api_reqs

	if (request.number) {
		// wait for messages to be loaded
		await pWaitFor(() => controller.task?.taskState.isInitialized === true, {
			timeout: 3_000,
		}).catch(() => {
			console.error("Failed to init new cline instance")
		})

		// NOTE: cancelTask awaits abortTask, which awaits diffViewProvider.revertChanges, which reverts any edited files, allowing us to reset to a checkpoint rather than running into a state where the revertChanges function is called alongside or after the checkpoint reset
		await controller.task?.restoreCheckpoint(request.number, request.restoreType as ClineCheckpointRestore, request.offset)
	}
	return Empty.create({})
}
