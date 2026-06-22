import { UpdateTerminalConnectionTimeoutRequest, UpdateTerminalConnectionTimeoutResponse } from "@shared/proto/cline/state"
import { Controller } from "../index"

export async function updateTerminalConnectionTimeout(
	_controller: Controller,
	_request: UpdateTerminalConnectionTimeoutRequest,
): Promise<UpdateTerminalConnectionTimeoutResponse> {
	return UpdateTerminalConnectionTimeoutResponse.create({})
}
