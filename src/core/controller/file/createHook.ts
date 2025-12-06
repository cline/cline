import { CreateHookRequest, CreateHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import path from "path"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { getHookTemplate } from "../../hooks/templates"
import { isValidHookType, resolveHooksDirectory, VALID_HOOK_TYPES } from "../../hooks/utils"
import { Controller } from ".."
import { refreshHooks } from "./refreshHooks"

export async function createHook(
	controller: Controller,
	request: CreateHookRequest,
	globalHooksDirOverride?: string,
): Promise<CreateHookResponse> {
	const { hookName, isGlobal, workspaceName } = request

	// Validate hook name is one of the valid hook types
	if (!isValidHookType(hookName)) {
		throw new Error(`Invalid hook type: "${hookName}". Valid hook types are: ${VALID_HOOK_TYPES.join(", ")}`)
	}

	// Determine target directory
	const hooksDir = await resolveHooksDirectory(isGlobal, workspaceName, globalHooksDirOverride)

	// Ensure directory exists
	await fs.mkdir(hooksDir, { recursive: true })

	const hookPath = path.join(hooksDir, hookName)

	// Check if already exists
	try {
		await fs.stat(hookPath)
		throw new Error(`Hook ${hookName} already exists at ${hookPath}`)
	} catch (error) {
		// Good - file doesn't exist yet
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
	}

	// Get template content
	const templateContent = getHookTemplate(hookName)

	// Write file WITHOUT executable permissions (644) so hook is toggled off by default
	// User can enable it later when they're ready
	const mode = 0o644
	await fs.writeFile(hookPath, templateContent, { mode })

	// Invalidate hook discovery cache
	await HookDiscoveryCache.getInstance().invalidateAll()

	// Return updated hooks state
	const hooksToggles = await refreshHooks(controller, undefined, globalHooksDirOverride)
	return CreateHookResponse.create({ hooksToggles })
}
