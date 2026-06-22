import { EmptyRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"
import { Controller } from "../index"

/**
 * Return the current extension state as a State proto.
 * The State proto carries the full ExtensionState serialized into its `stateJson` field.
 */
export async function getLatestState(controller: Controller, _: EmptyRequest): Promise<State> {
	const state = await controller.getStateToPostToWebview()
	return State.create({ stateJson: JSON.stringify(state) })
}
