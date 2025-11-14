import type { EmptyRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Flush all pending state changes immediately to disk
 * Bypasses the debounced persistence and forces immediate writes
 */
export async function flushPendingState(controller: Controller, request: EmptyRequest): Promise<Empty> {
	try {
		await controller.stateManager.flushPendingState()
		return Empty.create({})
	} catch (error) {
		console.error("[flushPendingState] Error flushing pending state:", error)
		throw error
	}
}
