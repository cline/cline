import { Empty, type EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/** Re-checks the account's ClinePass plan; the coordinator re-posts state when the answer changes. */
export async function refreshClinePassSubscription(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.refreshClinePassSubscription()
	return Empty.create()
}
