import { CheckpointRestoreRequest } from "@shared/proto/cline/checkpoints"
import { Empty } from "@shared/proto/cline/common"
import pWaitFor from "p-wait-for"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"
import { ClineCheckpointRestore } from "../../../shared/WebviewMessage"
import { Controller } from ".."

export async function checkpointRestore(controller: Controller, request: CheckpointRestoreRequest): Promise<Empty> {
	await controller.cancelTask() // we cannot alter message history say if the task is active, as it could be in the middle of editing a file or running a command, which expect the ask to be responded to rather than being superseded by a new message eg add deleted_api_reqs

	if (request.number) {
		// wait for messages to be loaded
		await pWaitFor(() => controller.task?.taskState.isInitialized === true, {
			timeout: 3_000,
		}).catch((error) => {
			console.log("Failed to init new Cline instance to restore checkpoint", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Failed to restore checkpoint",
			})
			throw error
		})

		// NOTE: cancelTask awaits abortTask, which awaits diffViewProvider.revertChanges, which reverts any edited files, allowing us to reset to a checkpoint rather than running into a state where the revertChanges function is called alongside or after the checkpoint reset
		await controller.task?.checkpointManager?.restoreCheckpoint(
			request.number,
			request.restoreType as ClineCheckpointRestore,
			request.offset,
		)
	}
	return Empty.create({})
}
