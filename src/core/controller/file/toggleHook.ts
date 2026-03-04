import { ToggleHookRequest, ToggleHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { resolveExistingHookPath, resolveHooksDirectory } from "../../hooks/utils"
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
	const hookPath = await resolveExistingHookPath(hooksDir, hookName)

	// Verify hook exists
	if (!hookPath) {
		throw new Error(`Hook ${hookName} does not exist in ${hooksDir}`)
	}

	// Persist toggles in StateManager (parity with rules/workflows/skills)
	if (isGlobal) {
		const globalHooksToggles = controller.stateManager.getGlobalSettingsKey("globalHooksToggles") || {}
		globalHooksToggles[hookPath] = enabled
		controller.stateManager.setGlobalState("globalHooksToggles", globalHooksToggles)
	} else {
		const localHooksToggles = controller.stateManager.getWorkspaceStateKey("localHooksToggles") || {}
		localHooksToggles[hookPath] = enabled
		controller.stateManager.setWorkspaceState("localHooksToggles", localHooksToggles)
	}

	// Keep Unix executable bit in sync for backward compatibility.
	if (process.platform !== "win32") {
		await fs.chmod(hookPath, enabled ? 0o755 : 0o644)
	}

	// Invalidate cache
	await HookDiscoveryCache.getInstance().invalidateAll()

	// Return updated state
	const hooksToggles = await refreshHooks(controller, undefined, globalHooksDirOverride)
	return ToggleHookResponse.create({ hooksToggles })
}
