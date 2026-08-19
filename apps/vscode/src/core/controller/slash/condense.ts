import { Empty, StringRequest } from "@shared/proto/cline/common"
import type { Controller } from ".."

/**
 * Condense / compact slash command logic.
 *
 * Runs a real SDK manual compaction over the active task's conversation
 * (the same effect as the CLI's `/compact` / `/smol` command), instead of
 * sending the literal text `/compact` to the model. The model does not treat
 * `/compact` as a command, so the old behavior produced an improvised fake
 * summary without actually compacting the context (CLINE-2503).
 */
export async function condense(controller: Controller, _request: StringRequest): Promise<Empty> {
	await controller.compactTask()
	return Empty.create()
}
