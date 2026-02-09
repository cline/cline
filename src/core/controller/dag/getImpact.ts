import type { BeadsmithIgnoreController } from "@core/ignore/BeadsmithIgnoreController"
import type { ImpactReport as DagImpactReport } from "@services/dag/types"
import { GetImpactRequest, ImpactReport } from "@shared/proto/beadsmith/dag"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."
import { convertImpactReport, convertProtoEdgeConfidence } from "./dag-conversions"

/**
 * Filter ignored files from an ImpactReport result.
 * Removes affected files, functions, and suggested tests that match .beadsmithignore rules.
 */
function filterIgnoredFromImpact(report: DagImpactReport, ignoreController: BeadsmithIgnoreController): DagImpactReport {
	// Filter affected files
	const filteredAffectedFiles = report.affectedFiles.filter((file) => ignoreController.validateAccess(file))

	// Filter affected functions - format is usually "file:function" so extract file path
	const filteredAffectedFunctions = report.affectedFunctions.filter((func) => {
		const filePath = func.split(":")[0]
		return ignoreController.validateAccess(filePath)
	})

	// Filter suggested tests
	const filteredSuggestedTests = report.suggestedTests.filter((test) => ignoreController.validateAccess(test))

	return {
		...report,
		affectedFiles: filteredAffectedFiles,
		affectedFunctions: filteredAffectedFunctions,
		suggestedTests: filteredSuggestedTests,
	}
}

/**
 * Gets impact analysis for a file or function
 * @param controller The controller instance
 * @param request The get impact request
 * @returns ImpactReport with the change impact analysis
 */
export async function getImpact(controller: Controller, request: GetImpactRequest): Promise<ImpactReport> {
	try {
		const dagBridge = await controller.ensureDagBridge()

		let result = await dagBridge.getImpact(request.file, request.function, {
			maxDepth: request.maxDepth,
			minConfidence: request.minConfidence ? convertProtoEdgeConfidence(request.minConfidence) : undefined,
		})

		// Filter out ignored files from the result
		const ignoreController = controller.getDagIgnoreController()
		if (ignoreController) {
			result = filterIgnoredFromImpact(result, ignoreController)
		}

		return convertImpactReport(result)
	} catch (error) {
		Logger.error("[getImpact] Failed to get impact analysis:", error)
		return ImpactReport.create({
			changedFile: request.file || "",
			affectedFiles: [],
			affectedFunctions: [],
			suggestedTests: [],
			confidenceBreakdown: {},
			impactDepth: 0,
			hasCircularDependencies: false,
		})
	}
}
