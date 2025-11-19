import { CreateHookRequest, CreateHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { getCwd, getDesktopDir } from "@/utils/path"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { getHookTemplate } from "../../hooks/templates"
import { Controller } from ".."
import { refreshHooks } from "./refreshHooks"

export async function createHook(controller: Controller, request: CreateHookRequest): Promise<CreateHookResponse> {
	const { hookName, isGlobal, workspaceName } = request

	// Determine target directory
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
	const hooksToggles = await refreshHooks(controller)
	return CreateHookResponse.create({ hooksToggles })
}
