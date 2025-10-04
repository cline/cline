import { EmptyRequest } from "@shared/proto/cline/common"
import { WorkspaceListResponse } from "@shared/proto/cline/task"
import { Controller } from ".."

/**
 * Gets the list of known workspaces from global state
 * @param controller The controller instance
 * @param request Empty request
 * @returns WorkspaceListResponse with list of workspaces sorted by most recently opened
 */
export async function getKnownWorkspaces(controller: Controller, request: EmptyRequest): Promise<WorkspaceListResponse> {
	try {
		const workspaceMetadata = controller.stateManager.getGlobalStateKey("workspaceMetadata") || {}

		// Convert metadata object to array and sort by lastOpened (descending)
		const workspaces = Object.values(workspaceMetadata)
			.sort((a, b) => b.lastOpened - a.lastOpened)
			.map((ws) => ({
				path: ws.path,
				name: ws.name,
				lastOpened: ws.lastOpened,
			}))

		return WorkspaceListResponse.create({ workspaces })
	} catch (error) {
		console.error("[getKnownWorkspaces] Error:", error)
		// Return empty list on error
		return WorkspaceListResponse.create({ workspaces: [] })
	}
}
