import { GetNodeEdgesRequest, GetNodeEdgesResponse } from "@shared/proto/beadsmith/dag"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."
import { convertEdge } from "./dag-conversions"

/**
 * Gets edges connected to a specific node
 * @param controller The controller instance
 * @param request The get node edges request
 * @returns GetNodeEdgesResponse with incoming and outgoing edges
 */
export async function getNodeEdges(controller: Controller, request: GetNodeEdgesRequest): Promise<GetNodeEdgesResponse> {
	try {
		const dagBridge = controller.getDagBridge()

		if (!dagBridge || !dagBridge.isRunning()) {
			Logger.debug("[getNodeEdges] DAG bridge not running, returning empty result")
			return GetNodeEdgesResponse.create({
				incoming: [],
				outgoing: [],
			})
		}

		const result = await dagBridge.getEdgesForNode(request.nodeId)

		return GetNodeEdgesResponse.create({
			incoming: result.incoming.map(convertEdge),
			outgoing: result.outgoing.map(convertEdge),
		})
	} catch (error) {
		Logger.error("[getNodeEdges] Failed to get node edges:", error)
		return GetNodeEdgesResponse.create({
			incoming: [],
			outgoing: [],
		})
	}
}
