import { ToggleHookRequest, ToggleHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { getCwd, getDesktopDir } from "@/utils/path"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { Controller } from ".."
import { refreshHooks } from "./refreshHooks"

export async function toggleHook(controller: Controller, request: ToggleHookRequest): Promise<ToggleHookResponse> {
	const { hookName, isGlobal, enabled, workspaceName } = request

	// Determine hook path
	let hooksDir: string
	if (isGlobal) {
		hooksDir = path.join(os.homedir(), "Documents", "Cline", "Hooks")
	} else {
		// For workspace hooks, find the correct workspace
		if (workspaceName) {
			// Multi-root workspace: find the workspace with this name
			const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
			const targetWorkspace = workspacePaths.paths.find((p) => path.basename(p) === workspaceName)
			if (!targetWorkspace) {
				throw new Error(`Workspace "${workspaceName}" not found`)
			}
			hooksDir = path.join(targetWorkspace, ".clinerules", "hooks")
		} else {
			// Single workspace: use getCwd
			const cwd = await getCwd(getDesktopDir())
			hooksDir = path.join(cwd, ".clinerules", "hooks")
		}
	}

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
	const hooksToggles = await refreshHooks(controller)
	return ToggleHookResponse.create({ hooksToggles })
}
