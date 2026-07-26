import { Empty, type EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function refreshBedrockDiscovery(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	void controller.bedrockStartup.refresh()
	return Empty.create()
}
