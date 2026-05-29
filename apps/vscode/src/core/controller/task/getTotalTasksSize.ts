import { EmptyRequest, Int64 } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { getTotalTasksSize as calculateTotalTasksSize } from "../../../utils/storage"
import { Controller } from ".."

/**
 * Gets the total size of all tasks including task data and checkpoints
 * @param controller The controller instance
 * @param _request The empty request
 * @returns The total size as an Int64 value
 */
export async function getTotalTasksSize(_controller: Controller, _request: EmptyRequest): Promise<Int64> {
	const startedAt = Date.now()
	const totalSize = await calculateTotalTasksSize()
	Logger.log(`[HistoryPerf] getTotalTasksSize totalSize=${totalSize ?? 0} took ${Date.now() - startedAt}ms`)
	return { value: totalSize || 0 }
}
