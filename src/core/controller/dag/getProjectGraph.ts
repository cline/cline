import type { ProjectGraph as DagProjectGraph } from "@services/dag/types"
import { EmptyRequest } from "@shared/proto/beadsmith/common"
import { ProjectGraph } from "@shared/proto/beadsmith/dag"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."
import { convertProjectGraph, createEmptyProjectGraph } from "./dag-conversions"

/**
 * Gets the current cached project graph
 * @param controller The controller instance
 * @param _request Empty request
 * @returns ProjectGraph with the cached dependency graph
 */
export async function getProjectGraph(controller: Controller, _request: EmptyRequest): Promise<ProjectGraph> {
	try {
		const dagBridge = controller.getDagBridge()

		if (!dagBridge || !dagBridge.isRunning()) {
			Logger.debug("[getProjectGraph] DAG bridge not running, returning empty graph")
			return createEmptyProjectGraph("")
		}

		const cachedGraph = await dagBridge.getCachedGraph()

		if (!cachedGraph) {
			Logger.debug("[getProjectGraph] No cached graph available")
			return createEmptyProjectGraph("")
		}

		return convertProjectGraph(cachedGraph as DagProjectGraph)
	} catch (error) {
		Logger.error("[getProjectGraph] Failed to get project graph:", error)
		return createEmptyProjectGraph("")
	}
}
