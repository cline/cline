import type { ProjectGraph as DagProjectGraph } from "@services/dag/types"
import { IncrementalAnalysisRequest, ProjectGraph } from "@shared/proto/beadsmith/dag"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."
import { convertProjectGraph, createEmptyProjectGraph } from "./dag-conversions"

/**
 * Performs incremental analysis on changed files
 * @param controller The controller instance
 * @param request The incremental analysis request
 * @returns ProjectGraph with the updated dependency graph
 */
export async function analyseIncremental(controller: Controller, request: IncrementalAnalysisRequest): Promise<ProjectGraph> {
	try {
		const dagBridge = await controller.ensureDagBridge()

		// Invalidate each changed file (the Python engine re-parses and rebuilds internally)
		for (const filePath of request.changedFiles) {
			await dagBridge.invalidateFile(filePath)
		}

		// Invalidate each deleted file
		for (const filePath of request.deletedFiles) {
			await dagBridge.invalidateFile(filePath)
		}

		Logger.info(
			`[analyseIncremental] Processed ${request.changedFiles.length} changed, ${request.deletedFiles.length} deleted files`,
		)

		// Return the updated cached graph
		const cachedGraph = await dagBridge.getCachedGraph()
		if (!cachedGraph) {
			return createEmptyProjectGraph("")
		}

		return convertProjectGraph(cachedGraph as DagProjectGraph)
	} catch (error) {
		Logger.error("[analyseIncremental] Failed to perform incremental analysis:", error)
		return createEmptyProjectGraph("")
	}
}
