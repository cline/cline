import * as vscode from "vscode"
import { Controller } from "@/core/controller"
import { updateWorkspaceMetadataFromEvent } from "@/core/controller/workspace/updateWorkspaceMetadataFromEvent"
import { WorkspaceChangeEvent } from "@/core/workspace/WorkspaceChangeEvent"

/**
 * Initialize VSCode-specific workspace tracking
 * Sets up listeners for workspace folder changes
 * Converts VSCode events to platform-agnostic format
 */
export function initializeVSCodeWorkspace(context: vscode.ExtensionContext, controller: Controller): void {
	// Listen for workspace folder changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
			// Convert VSCode event to platform-agnostic format
			const changeEvent: WorkspaceChangeEvent = {
				added: event.added.map((folder) => ({
					path: folder.uri.fsPath,
					name: folder.name,
				})),
				removed: event.removed.map((folder) => ({
					path: folder.uri.fsPath,
					name: folder.name,
				})),
			}

			// Call shared function with platform-agnostic event
			await updateWorkspaceMetadataFromEvent(controller, changeEvent)

			// Update workspace manager with new folders
			await controller.ensureWorkspaceManager()

			// CRITICAL: Notify frontend of workspace change
			await controller.postStateToWebview()
		}),
	)
}
