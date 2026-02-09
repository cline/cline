import { QueryNodesRequest, QueryNodesResponse } from "@shared/proto/beadsmith/dag"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."
import { convertNode, convertProtoNodeType } from "./dag-conversions"

/**
 * Gets nodes that match a query (file path, symbol name, etc.)
 * @param controller The controller instance
 * @param request The query nodes request
 * @returns QueryNodesResponse with matching nodes
 */
export async function queryNodes(controller: Controller, request: QueryNodesRequest): Promise<QueryNodesResponse> {
	try {
		const dagBridge = controller.getDagBridge()

		if (!dagBridge || !dagBridge.isRunning()) {
			Logger.debug("[queryNodes] DAG bridge not running, returning empty result")
			return QueryNodesResponse.create({
				nodes: [],
				totalCount: 0,
			})
		}

		const result = await dagBridge.queryNodes({
			filePath: request.filePath || undefined,
			name: request.name || undefined,
			type: request.type ? convertProtoNodeType(request.type) : undefined,
			limit: request.limit || 100,
		})

		return QueryNodesResponse.create({
			nodes: result.nodes.map(convertNode),
			totalCount: result.totalCount,
		})
	} catch (error) {
		Logger.error("[queryNodes] Failed to query nodes:", error)
		return QueryNodesResponse.create({
			nodes: [],
			totalCount: 0,
		})
	}
}
