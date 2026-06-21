import { ToggleHookRequest, ToggleHookResponse } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function toggleHook(
	_controller: Controller,
	_request: ToggleHookRequest,
	_globalHooksDirOverride?: string,
): Promise<ToggleHookResponse> {
	return ToggleHookResponse.create({})
}
