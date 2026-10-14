import { isPersistedCloudSessionId } from "@shared/cloud/cloud-sessions"
import { Empty, type StringRequest } from "@shared/proto/cline/common"
import { openExternal } from "@/utils/env"
import type { Controller } from "../index"

export async function openCloudSessionDashboard(controller: Controller, request: StringRequest): Promise<Empty> {
	if (!isPersistedCloudSessionId(request.value)) {
		throw new Error("The cloud session is not ready to open in the dashboard.")
	}
	await openExternal(controller.cloudSessions.dashboardUrl(request.value))
	return Empty.create()
}
