import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { getLatencyObserverService } from "@/services/latency/LatencyObserverService"
import { Controller } from "../index"

export async function resetLatencyObserver(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	getLatencyObserverService().reset()
	await controller.postStateToWebview()
	return Empty.create({})
}
