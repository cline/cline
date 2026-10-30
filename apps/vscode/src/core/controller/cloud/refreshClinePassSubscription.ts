import { type BooleanRequest, Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Re-checks the account's ClinePass plan; the coordinator re-posts state when
 * the answer changes. `value` bypasses the recent-answer window.
 */
export async function refreshClinePassSubscription(controller: Controller, request: BooleanRequest): Promise<Empty> {
	await controller.refreshClinePassSubscription({ force: request.value })
	return Empty.create()
}
