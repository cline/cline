import { UpdateTerminalConnectionTimeoutRequest, UpdateTerminalConnectionTimeoutResponse } from "@shared/proto/cline/state"
import { Controller } from "../index"

export async function updateTerminalConnectionTimeout(
	controller: Controller,
	request: UpdateTerminalConnectionTimeoutRequest,
): Promise<UpdateTerminalConnectionTimeoutResponse> {
	const timeoutMs = request.timeoutMs

	// Update the terminal connection timeout setting in the state
	controller.stateManager.setGlobalState("shellIntegrationTimeout", timeoutMs || 4000)

	// Broadcast state update to all webviews
	await controller.postStateToWebview()

	return { timeoutMs }
}
