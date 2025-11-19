import { DeleteHookRequest, DeleteHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { getCwd, getDesktopDir } from "@/utils/path"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { Controller } from ".."
import { refreshHooks } from "./refreshHooks"

export async function deleteHook(controller: Controller, request: DeleteHookRequest): Promise<DeleteHookResponse> {
	const { hookName, isGlobal } = request

	const cwd = await getCwd(getDesktopDir())

	// Determine hook path
	const hooksDir = isGlobal ? path.join(os.homedir(), "Documents", "Cline", "Hooks") : path.join(cwd, ".clinerules", "hooks")

	const hookPath = path.join(hooksDir, hookName)

	// Delete the hook file
	await fs.unlink(hookPath)

	// Invalidate hook discovery cache
	await HookDiscoveryCache.getInstance().invalidateAll()

	// Return updated hooks state
	const hooksToggles = await refreshHooks(controller)
	return DeleteHookResponse.create({ hooksToggles })
}
