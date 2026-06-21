import type { EmptyRequest } from "@shared/proto/cline/common"
import { Boolean } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Marks the current announcement as shown
 */
export async function onDidShowAnnouncement(_controller: Controller, _request: EmptyRequest): Promise<Boolean> {
	return Boolean.create({})
}
