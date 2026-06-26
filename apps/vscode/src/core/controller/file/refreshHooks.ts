import { listHookConfigFiles } from "@cline/core"
import { HookInfo, HooksToggles, WorkspaceHooks } from "@shared/proto/cline/file"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { Controller } from ".."

export async function refreshHooks(_controller: Controller, _request?: any): Promise<HooksToggles> {
	const toHookInfo = (entry: ReturnType<typeof listHookConfigFiles>[number]): HookInfo =>
		HookInfo.create({
			name: entry.fileName,
			absolutePath: entry.path,
			hookEventName: entry.hookEventName ?? "",
		})

	const globalEntries = listHookConfigFiles()
	const globalHookPaths = new Set(globalEntries.map((entry) => entry.path))
	const globalHooks = globalEntries.map(toHookInfo)

	// Collect workspace hooks from all workspace folders
	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
	const workspaceHooksList: WorkspaceHooks[] = []

	for (const workspacePath of workspacePaths.paths) {
		const hooks = listHookConfigFiles(workspacePath)
			.filter((entry) => !globalHookPaths.has(entry.path))
			.map(toHookInfo)

		// Add all workspaces, even if they have no hooks yet
		const workspaceName = path.basename(workspacePath)
		workspaceHooksList.push(
			WorkspaceHooks.create({
				workspaceName,
				hooks,
			}),
		)
	}

	return HooksToggles.create({
		globalHooks,
		workspaceHooks: workspaceHooksList,
	})
}
