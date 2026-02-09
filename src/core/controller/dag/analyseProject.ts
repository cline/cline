import type { BeadsmithIgnoreController } from "@core/ignore/BeadsmithIgnoreController"
import type { ProjectGraph as DagProjectGraph } from "@services/dag/types"
import { AnalyseProjectRequest, ProjectGraph } from "@shared/proto/beadsmith/dag"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."
import { convertProjectGraph, createEmptyProjectGraph } from "./dag-conversions"

/**
 * Filter ignored files from a ProjectGraph result.
 * Removes nodes, edges, and warnings for files that match .beadsmithignore rules.
 */
function filterIgnoredFromGraph(graph: DagProjectGraph, ignoreController: BeadsmithIgnoreController): DagProjectGraph {
	// Filter nodes - remove any whose filePath is ignored
	const filteredNodes = graph.nodes.filter((node) => ignoreController.validateAccess(node.filePath))

	// Create a set of allowed node IDs for efficient edge filtering
	const allowedNodeIds = new Set(filteredNodes.map((n) => n.id))

	// Filter edges - remove any where either endpoint's node is filtered out
	const filteredEdges = graph.edges.filter((edge) => allowedNodeIds.has(edge.fromNode) && allowedNodeIds.has(edge.toNode))

	// Filter warnings - remove any for ignored files
	const filteredWarnings = graph.warnings.filter((warning) => ignoreController.validateAccess(warning.file))

	// Recalculate summary statistics
	const fileSet = new Set(filteredNodes.filter((n) => n.type === "file").map((n) => n.filePath))
	const functionCount = filteredNodes.filter((n) => n.type === "function" || n.type === "method").length
	const classCount = filteredNodes.filter((n) => n.type === "class").length

	const highConfidenceEdges = filteredEdges.filter((e) => e.confidence === "high").length
	const mediumConfidenceEdges = filteredEdges.filter((e) => e.confidence === "medium").length
	const lowConfidenceEdges = filteredEdges.filter((e) => e.confidence === "low").length
	const unsafeEdges = filteredEdges.filter((e) => e.confidence === "unsafe").length

	return {
		...graph,
		nodes: filteredNodes,
		edges: filteredEdges,
		warnings: filteredWarnings,
		summary: {
			...graph.summary,
			files: fileSet.size,
			functions: functionCount,
			classes: classCount,
			edges: filteredEdges.length,
			highConfidenceEdges,
			mediumConfidenceEdges,
			lowConfidenceEdges,
			unsafeEdges,
		},
	}
}

/**
 * Analyses a project and builds the dependency graph
 * @param controller The controller instance
 * @param request The analyse project request
 * @returns ProjectGraph with the dependency graph
 */
export async function analyseProject(controller: Controller, request: AnalyseProjectRequest): Promise<ProjectGraph> {
	try {
		const dagBridge = await controller.ensureDagBridge()
		const workspaceRoot = controller.getWorkspaceManager()?.getPrimaryRoot()?.path
		const root = request.root || workspaceRoot || ""
		Logger.info(`[analyseProject] root="${root}", request.root="${request.root}", workspaceRoot="${workspaceRoot}"`)
		let result = await dagBridge.analyseProject(root)

		// Filter out ignored files from the result
		const ignoreController = controller.getDagIgnoreController()
		if (ignoreController) {
			result = filterIgnoredFromGraph(result, ignoreController)
		}

		return convertProjectGraph(result)
	} catch (error) {
		Logger.error("[analyseProject] Failed to analyse project:", error)
		return createEmptyProjectGraph(request.root || "")
	}
}
