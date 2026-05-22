import { EmptyRequest } from "@shared/proto/cline/common"
import type { MapSessionState } from "@shared/proto/cline/map"
import type { Controller } from ".."

export async function getMapSession(controller: Controller, _request: EmptyRequest): Promise<MapSessionState> {
	await controller.refreshMapSessionWorkspaceRoot()
	return controller.mapSessionService.buildSnapshot(controller.getMapLayers())
}
