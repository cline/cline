import { Controller } from "../index"
import { UpdateTerminalConnectionTimeoutRequest, UpdateTerminalConnectionTimeoutResponse } from "@shared/proto/cline/state"

export async function updateTerminalConnectionTimeout(
	controller: Controller,
	request: UpdateTerminalConnectionTimeoutRequest,
): Promise<UpdateTerminalConnectionTimeoutResponse> {
	const timeoutMs = request.timeoutMs

	// Update the terminal connection timeout setting in the state
	controller.cacheService.setGlobalState("shellIntegrationTimeout", timeoutMs || 4000)

	// Broadcast state update to all webviews
	await controller.postStateToWebview()

	return { timeoutMs }
}
