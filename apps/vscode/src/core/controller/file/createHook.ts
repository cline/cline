import { CreateHookRequest, CreateHookResponse } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function createHook(
	_controller: Controller,
	_request: CreateHookRequest,
	_globalHooksDirOverride?: string,
): Promise<CreateHookResponse> {
	return CreateHookResponse.create({})
}
