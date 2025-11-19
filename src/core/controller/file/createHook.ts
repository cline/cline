import { CreateHookRequest, CreateHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { getCwd, getDesktopDir } from "@/utils/path"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { getHookTemplate } from "../../hooks/templates"
import { Controller } from ".."
import { refreshHooks } from "./refreshHooks"

export async function createHook(controller: Controller, request: CreateHookRequest): Promise<CreateHookResponse> {
	const { hookName, isGlobal } = request

	const cwd = await getCwd(getDesktopDir())

	// Determine target directory
	const hooksDir = isGlobal ? path.join(os.homedir(), "Documents", "Cline", "Hooks") : path.join(cwd, ".clinerules", "hooks")

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

	// Write file with executable permissions (755 on Unix, 644 on Windows)
	const mode = process.platform === "win32" ? 0o644 : 0o755
	await fs.writeFile(hookPath, templateContent, { mode })

	// Invalidate hook discovery cache
	await HookDiscoveryCache.getInstance().invalidateAll()

	// Return updated hooks state
	const hooksToggles = await refreshHooks(controller)
	return CreateHookResponse.create({ hooksToggles })
}
