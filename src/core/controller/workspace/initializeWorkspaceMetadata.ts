import { HostProvider } from "@/hosts/host-provider"
import { Controller } from ".."

/**
 * Initializes workspaceMetadata from currently open workspace folders
 * Called on extension activation
 * Platform-agnostic: works with both VSCode and JetBrains
 */
export async function initializeWorkspaceMetadata(controller: Controller): Promise<void> {
	try {
		// Use gRPC WorkspaceService instead of vscode.workspace
		const response = await HostProvider.workspace.getWorkspacePaths({})
		const workspacePaths = response.paths || []

		const existingMetadata = controller.stateManager.getGlobalStateKey("workspaceMetadata") || {}

		// Update metadata for currently open workspaces
		for (const path of workspacePaths) {
			// Extract name from path (works on Windows and Unix)
			const name = path.split("/").pop() || path.split("\\").pop() || path

			// Only update if not already present or update lastOpened
			if (!existingMetadata[path]) {
				existingMetadata[path] = {
					path,
					name,
					lastOpened: Date.now(),
				}
			} else {
				// Update lastOpened timestamp
				existingMetadata[path].lastOpened = Date.now()
			}
		}

		controller.stateManager.setGlobalState("workspaceMetadata", existingMetadata)
		console.log(`[initializeWorkspaceMetadata] Initialized ${workspacePaths.length} workspace(s)`)
	} catch (error) {
		console.error("[initializeWorkspaceMetadata] Error:", error)
	}
}
