import { EmptyRequest } from "@shared/proto/beadsmith/common"
import { DagServiceStatus } from "@shared/proto/beadsmith/dag"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."

/**
 * Gets the status of the DAG service
 * @param controller The controller instance
 * @param _request Empty request
 * @returns DagServiceStatus with service status information
 */
export async function getStatus(controller: Controller, _request: EmptyRequest): Promise<DagServiceStatus> {
	try {
		const dagBridge = controller.getDagBridge()

		if (!dagBridge) {
			return DagServiceStatus.create({
				running: false,
				version: "0.1.0",
				hasCache: false,
				error: "DAG bridge not initialized",
			})
		}

		if (!dagBridge.isRunning()) {
			return DagServiceStatus.create({
				running: false,
				version: "0.1.0",
				hasCache: false,
				error: "DAG bridge not running",
			})
		}

		const status = await dagBridge.getStatus()

		return DagServiceStatus.create({
			running: status.running,
			version: status.version,
			hasCache: status.hasCache,
			lastAnalysis: status.lastAnalysis,
			fileCount: status.fileCount,
			error: status.error,
		})
	} catch (error) {
		Logger.error("[getStatus] Failed to get DAG status:", error)
		return DagServiceStatus.create({
			running: false,
			version: "0.1.0",
			hasCache: false,
			error: error instanceof Error ? error.message : "Unknown error",
		})
	}
}
