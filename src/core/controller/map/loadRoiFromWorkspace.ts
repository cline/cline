import type { LoadRoiFromWorkspaceRequest, LoadRoiFromWorkspaceResponse } from "@shared/proto/cline/map"
import { LoadRoiFromWorkspaceResponse as LoadRoiFromWorkspaceResponseProto } from "@shared/proto/cline/map"
import type { Controller } from ".."

export async function loadRoiFromWorkspace(
	controller: Controller,
	request: LoadRoiFromWorkspaceRequest,
): Promise<LoadRoiFromWorkspaceResponse> {
	await controller.refreshMapSessionWorkspaceRoot()
	const roi = await controller.mapSessionService.loadRoiFromWorkspace(request.workspacePath)
	return LoadRoiFromWorkspaceResponseProto.create({ roi })
}
