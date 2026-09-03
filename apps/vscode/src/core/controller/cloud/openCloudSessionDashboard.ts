import { Empty, type StringRequest } from "@shared/proto/cline/common"
import { openExternal } from "@/utils/env"
import type { Controller } from "../index"

export async function openCloudSessionDashboard(controller: Controller, request: StringRequest): Promise<Empty> {
	await openExternal(controller.cloudSessions.dashboardUrl(request.value))
	return Empty.create()
}
