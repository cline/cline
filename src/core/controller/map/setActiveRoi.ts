import { Empty } from "@shared/proto/cline/common"
import type { SetActiveRoiRequest } from "@shared/proto/cline/map"
import type { Controller } from ".."

export async function setActiveRoi(controller: Controller, request: SetActiveRoiRequest): Promise<Empty> {
	await controller.refreshMapSessionWorkspaceRoot()
	if (request.roi?.geojson?.trim()) {
		controller.mapSessionService.setActiveRoi(request.roi, request.roi.source || "user")
	} else {
		controller.mapSessionService.clearActiveRoi("user")
	}
	return Empty.create()
}
