import { HooksToggles } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function refreshHooks(
	_controller: Controller,
	_request?: any,
	_globalHooksDirOverride?: string,
): Promise<HooksToggles> {
	return HooksToggles.create({})
}
