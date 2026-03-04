import { HookInfo, HooksToggles, WorkspaceHooks } from "@shared/proto/cline/file"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { resolveExistingHookPath, VALID_HOOK_TYPES } from "../../hooks/utils"
import { Controller } from ".."

export async function refreshHooks(
	controller: Controller,
	_request?: any,
	globalHooksDirOverride?: string,
): Promise<HooksToggles> {
	const globalHooksDir = globalHooksDirOverride || path.join(os.homedir(), "Documents", "Cline", "Hooks")

	const globalHooksToggles = controller.stateManager.getGlobalSettingsKey("globalHooksToggles") || {}
	const localHooksToggles = controller.stateManager.getWorkspaceStateKey("localHooksToggles") || {}

	const existingGlobalHookPaths = new Set<string>()
	const existingLocalHookPaths = new Set<string>()
	let didMutateGlobalToggles = false
	let didMutateLocalToggles = false

	// Collect global hooks
	const globalHooks: HookInfo[] = []
	for (const hookName of VALID_HOOK_TYPES) {
		const hookPath = await resolveExistingHookPath(globalHooksDir, hookName)
		if (hookPath) {
			existingGlobalHookPaths.add(hookPath)
			const legacyEnabled = await isExecutable(hookPath)
			const enabled = globalHooksToggles[hookPath] ?? legacyEnabled

			if (!(hookPath in globalHooksToggles)) {
				globalHooksToggles[hookPath] = enabled
				didMutateGlobalToggles = true
			}

			globalHooks.push(
				HookInfo.create({
					name: hookName,
					enabled,
					absolutePath: hookPath,
				}),
			)
		}
	}

	// Collect workspace hooks from all workspace folders
	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
	const workspaceHooksList: WorkspaceHooks[] = []

	for (const workspacePath of workspacePaths.paths) {
		const workspaceHooksDir = path.join(workspacePath, ".clinerules", "hooks")
		const hooks: HookInfo[] = []

		for (const hookName of VALID_HOOK_TYPES) {
			const hookPath = await resolveExistingHookPath(workspaceHooksDir, hookName)
			if (hookPath) {
				existingLocalHookPaths.add(hookPath)
				const legacyEnabled = await isExecutable(hookPath)
				const enabled = localHooksToggles[hookPath] ?? legacyEnabled

				if (!(hookPath in localHooksToggles)) {
					localHooksToggles[hookPath] = enabled
					didMutateLocalToggles = true
				}

				hooks.push(
					HookInfo.create({
						name: hookName,
						enabled,
						absolutePath: hookPath,
					}),
				)
			}
		}

		// Add all workspaces, even if they have no hooks yet
		// This allows users to create their first hook via the dropdown
		const workspaceName = path.basename(workspacePath)
		workspaceHooksList.push(
			WorkspaceHooks.create({
				workspaceName,
				hooks,
			}),
		)
	}

	for (const togglePath of Object.keys(globalHooksToggles)) {
		if (!existingGlobalHookPaths.has(togglePath)) {
			delete globalHooksToggles[togglePath]
			didMutateGlobalToggles = true
		}
	}

	for (const togglePath of Object.keys(localHooksToggles)) {
		if (!existingLocalHookPaths.has(togglePath)) {
			delete localHooksToggles[togglePath]
			didMutateLocalToggles = true
		}
	}

	if (didMutateGlobalToggles) {
		controller.stateManager.setGlobalState("globalHooksToggles", globalHooksToggles)
	}

	if (didMutateLocalToggles) {
		controller.stateManager.setWorkspaceState("localHooksToggles", localHooksToggles)
	}

	return HooksToggles.create({
		globalHooks,
		workspaceHooks: workspaceHooksList,
		isWindows: process.platform === "win32",
	})
}

async function isExecutable(filePath: string): Promise<boolean> {
	try {
		if (process.platform === "win32") {
			await fs.access(filePath)
			return true
		}

		await fs.access(filePath, fs.constants.X_OK)
		return true
	} catch {
		return false
	}
}
