import * as vscode from "vscode"
import { Controller } from ".."

/**
 * Updates workspaceMetadata when workspace folders change
 * Called by workspace.onDidChangeWorkspaceFolders listener
 */
export async function updateWorkspaceMetadataFromEvent(
	controller: Controller,
	event: vscode.WorkspaceFoldersChangeEvent,
): Promise<void> {
	try {
		const metadata = controller.stateManager.getGlobalStateKey("workspaceMetadata") || {}

		// Add new workspaces
		for (const folder of event.added) {
			const path = folder.uri.fsPath
			metadata[path] = {
				path,
				name: folder.name,
				lastOpened: Date.now(),
			}
			console.log(`[updateWorkspaceMetadata] Added workspace: ${folder.name}`)
		}

		// Note: We DON'T remove workspaces on removal - keep history
		// Just log the removal
		for (const folder of event.removed) {
			console.log(`[updateWorkspaceMetadata] Workspace removed (keeping metadata): ${folder.name}`)
		}

		controller.stateManager.setGlobalState("workspaceMetadata", metadata)
	} catch (error) {
		console.error("[updateWorkspaceMetadataFromEvent] Error:", error)
	}
}
