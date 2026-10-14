import { CloudSessionStatusItem, CloudSessionStatusList, type CloudSessionStatusRequest } from "@shared/proto/cline/cloud"
import type { Controller } from "../index"

/** Resolves live agent status for only the cloud sessions named by the visible UI surface. */
export async function resolveCloudSessionStatuses(
	controller: Controller,
	request: CloudSessionStatusRequest,
): Promise<CloudSessionStatusList> {
	const statuses = await controller.resolveCloudSessionStatuses(request.sessionIds)
	return CloudSessionStatusList.create({
		statuses: statuses.map(({ sessionId, status }) => CloudSessionStatusItem.create({ sessionId, status })),
	})
}
