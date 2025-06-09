import { Controller } from "../index"
import * as proto from "@/shared/proto"
import { updateGlobalState } from "../../storage/state"

export async function updateDefaultTerminalProfile(
	controller: Controller,
	request: proto.cline.StringRequest,
): Promise<proto.cline.Empty> {
	const profileId = request.value

	// Update the terminal profile in the state
	await updateGlobalState(controller.context, "defaultTerminalProfile", profileId)

	// Update the terminal manager of the current task if it exists
	if (controller.task) {
		controller.task.terminalManager.setDefaultTerminalProfile(profileId)
	}

	// Broadcast state update to all webviews
	await controller.postStateToWebview()

	return proto.cline.Empty.create({})
}
