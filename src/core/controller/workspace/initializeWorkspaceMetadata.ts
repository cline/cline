import * as vscode from "vscode"
import { Controller } from ".."

/**
 * Initializes workspaceMetadata from currently open workspace folders
 * Called on extension activation
 */
export async function initializeWorkspaceMetadata(controller: Controller): Promise<void> {
	try {
		// biome-ignore lint: Direct vscode.workspace access needed for initialization
		const workspaceFolders = vscode.workspace.workspaceFolders || []
		const existingMetadata = controller.stateManager.getGlobalStateKey("workspaceMetadata") || {}

		// Update metadata for currently open workspaces
		for (const folder of workspaceFolders) {
			const path = folder.uri.fsPath

			// Only update if not already present or update lastOpened
			if (!existingMetadata[path]) {
				existingMetadata[path] = {
					path,
					name: folder.name,
					lastOpened: Date.now(),
				}
			} else {
				// Update lastOpened timestamp
				existingMetadata[path].lastOpened = Date.now()
			}
		}

		controller.stateManager.setGlobalState("workspaceMetadata", existingMetadata)
		console.log(`[initializeWorkspaceMetadata] Initialized ${workspaceFolders.length} workspace(s)`)
	} catch (error) {
		console.error("[initializeWorkspaceMetadata] Error:", error)
	}
}
