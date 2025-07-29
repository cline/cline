import { Controller } from "../index"
import { UpdateTerminalConnectionTimeoutRequest, UpdateTerminalConnectionTimeoutResponse } from "@shared/proto/cline/state"
import { updateGlobalState } from "../../storage/state"

export async function updateTerminalConnectionTimeout(
	controller: Controller,
	request: UpdateTerminalConnectionTimeoutRequest,
): Promise<UpdateTerminalConnectionTimeoutResponse> {
	const timeoutMs = request.timeoutMs

	// Update the terminal connection timeout setting in the state
	await updateGlobalState(controller.context, "shellIntegrationTimeout", timeoutMs)

	// Broadcast state update to all webviews
	await controller.postStateToWebview()

	return { timeoutMs }
}
