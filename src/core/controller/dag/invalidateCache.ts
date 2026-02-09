import { Empty, EmptyRequest } from "@shared/proto/beadsmith/common"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."

/**
 * Invalidates cache and forces re-analysis
 * @param controller The controller instance
 * @param _request Empty request
 * @returns Empty response
 */
export async function invalidateCache(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		const dagBridge = controller.getDagBridge()

		if (dagBridge && dagBridge.isRunning()) {
			await dagBridge.clearCache()
			Logger.info("[invalidateCache] DAG cache cleared successfully")
		} else {
			Logger.debug("[invalidateCache] DAG bridge not running, nothing to invalidate")
		}

		return Empty.create()
	} catch (error) {
		Logger.error("[invalidateCache] Failed to invalidate cache:", error)
		return Empty.create()
	}
}
