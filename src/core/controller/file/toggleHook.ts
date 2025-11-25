import { ToggleHookRequest, ToggleHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import path from "path"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { resolveHooksDirectory } from "../../hooks/utils"
import { Controller } from ".."
import { refreshHooks } from "./refreshHooks"

export async function toggleHook(
	controller: Controller,
	request: ToggleHookRequest,
	globalHooksDirOverride?: string,
): Promise<ToggleHookResponse> {
	const { hookName, isGlobal, enabled, workspaceName } = request

	// Determine hook path
	const hooksDir = await resolveHooksDirectory(isGlobal, workspaceName, globalHooksDirOverride)

	const hookPath = path.join(hooksDir, hookName)

	// Verify hook exists
	try {
		await fs.stat(hookPath)
	} catch {
		throw new Error(`Hook ${hookName} does not exist at ${hookPath}`)
	}

	// On Windows, we can't use chmod, so we just return the current state
	// without modifying the file. The frontend will disable the toggle.
	if (process.platform !== "win32") {
		// Toggle executable bit (Unix-like systems only)
		await fs.chmod(hookPath, enabled ? 0o755 : 0o644)
	}

	// Invalidate cache
	await HookDiscoveryCache.getInstance().invalidateAll()

	// Return updated state
	const hooksToggles = await refreshHooks(controller, undefined, globalHooksDirOverride)
	return ToggleHookResponse.create({ hooksToggles })
}
