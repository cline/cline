import { DeleteHookRequest, DeleteHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { resolveExistingHookPath, resolveHooksDirectory } from "../../hooks/utils"
import { Controller } from ".."
import { refreshHooks } from "./refreshHooks"

export async function deleteHook(
	controller: Controller,
	request: DeleteHookRequest,
	globalHooksDirOverride?: string,
): Promise<DeleteHookResponse> {
	const { hookName, isGlobal, workspaceName } = request

	// Determine hook path
	const hooksDir = await resolveHooksDirectory(isGlobal, workspaceName, globalHooksDirOverride)
	const hookPath = await resolveExistingHookPath(hooksDir, hookName)

	// Verify hook exists before attempting deletion
	if (!hookPath) {
		throw new Error(`Hook ${hookName} does not exist in ${hooksDir}`)
	}

	// Delete the hook file
	await fs.unlink(hookPath)

	// Remove toggle entry
	if (isGlobal) {
		const globalHooksToggles = controller.stateManager.getGlobalSettingsKey("globalHooksToggles") || {}
		delete globalHooksToggles[hookPath]
		controller.stateManager.setGlobalState("globalHooksToggles", globalHooksToggles)
	} else {
		const localHooksToggles = controller.stateManager.getWorkspaceStateKey("localHooksToggles") || {}
		delete localHooksToggles[hookPath]
		controller.stateManager.setWorkspaceState("localHooksToggles", localHooksToggles)
	}

	// Invalidate hook discovery cache
	await HookDiscoveryCache.getInstance().invalidateAll()

	// Return updated hooks state
	const hooksToggles = await refreshHooks(controller, undefined, globalHooksDirOverride)
	return DeleteHookResponse.create({ hooksToggles })
}
