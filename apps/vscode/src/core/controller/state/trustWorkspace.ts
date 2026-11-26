import { Empty, type EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Records that the user trusts the open folder, so the chat replaces the trust prompt.
 */
export async function trustWorkspace(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.trustCurrentWorkspace()
	return Empty.create({})
}
