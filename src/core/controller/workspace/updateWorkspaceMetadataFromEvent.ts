import { WorkspaceChangeEvent } from "@/core/workspace/WorkspaceChangeEvent"
import { Controller } from ".."

/**
 * Updates workspaceMetadata when workspace folders change
 * Called by workspace change listeners (platform-agnostic)
 * Platform-agnostic: works with both VSCode and JetBrains
 */
export async function updateWorkspaceMetadataFromEvent(controller: Controller, event: WorkspaceChangeEvent): Promise<void> {
	try {
		const metadata = controller.stateManager.getGlobalStateKey("workspaceMetadata") || {}

		// Add new workspaces
		for (const workspace of event.added) {
			metadata[workspace.path] = {
				path: workspace.path,
				name: workspace.name,
				lastOpened: Date.now(),
			}
			console.log(`[updateWorkspaceMetadata] Added workspace: ${workspace.name}`)
		}

		// Note: We DON'T remove workspaces on removal - keep history
		// Just log the removal
		for (const workspace of event.removed) {
			console.log(`[updateWorkspaceMetadata] Workspace removed (keeping metadata): ${workspace.name}`)
		}

		controller.stateManager.setGlobalState("workspaceMetadata", metadata)
	} catch (error) {
		console.error("[updateWorkspaceMetadataFromEvent] Error:", error)
	}
}
