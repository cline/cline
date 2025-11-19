import { ToggleHookRequest, ToggleHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { getCwd, getDesktopDir } from "@/utils/path"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { Controller } from ".."
import { refreshHooks } from "./refreshHooks"

export async function toggleHook(controller: Controller, request: ToggleHookRequest): Promise<ToggleHookResponse> {
	const { hookName, isGlobal, enabled } = request

	const cwd = await getCwd(getDesktopDir())

	// Determine hook path
	const hooksDir = isGlobal ? path.join(os.homedir(), "Documents", "Cline", "Hooks") : path.join(cwd, ".clinerules", "hooks")

	const hookPath = path.join(hooksDir, hookName)

	// Verify hook exists
	try {
		await fs.stat(hookPath)
	} catch {
		throw new Error(`Hook ${hookName} does not exist at ${hookPath}`)
	}

	// Windows doesn't support chmod
	if (process.platform === "win32") {
		throw new Error("Toggling hooks is not supported on Windows")
	}

	// Toggle executable bit
	await fs.chmod(hookPath, enabled ? 0o755 : 0o644)

	// Invalidate cache
	await HookDiscoveryCache.getInstance().invalidateAll()

	// Return updated state
	const hooksToggles = await refreshHooks(controller)
	return ToggleHookResponse.create({ hooksToggles })
}
