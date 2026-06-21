import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Initialize webview when it launches
 */
export async function initializeWebview(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	return Empty.create({})
}
