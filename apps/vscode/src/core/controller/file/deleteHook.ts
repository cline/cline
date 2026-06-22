import { DeleteHookRequest, DeleteHookResponse } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function deleteHook(
	_controller: Controller,
	_request: DeleteHookRequest,
	_globalHooksDirOverride?: string,
): Promise<DeleteHookResponse> {
	return DeleteHookResponse.create({})
}
