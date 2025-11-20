import { DeleteHookRequest, DeleteHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import path from "path"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { resolveHooksDirectory } from "../../hooks/utils"
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

	const hookPath = path.join(hooksDir, hookName)

	// Verify hook exists before attempting deletion
	try {
		await fs.stat(hookPath)
	} catch {
		throw new Error(`Hook ${hookName} does not exist at ${hookPath}`)
	}

	// Delete the hook file
	await fs.unlink(hookPath)

	// Invalidate hook discovery cache
	await HookDiscoveryCache.getInstance().invalidateAll()

	// Return updated hooks state
	const hooksToggles = await refreshHooks(controller, undefined, globalHooksDirOverride)
	return DeleteHookResponse.create({ hooksToggles })
}
