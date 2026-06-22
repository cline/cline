import { EmptyRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"
import { Controller } from "../index"

export async function getLatestState(_controller: Controller, _: EmptyRequest): Promise<State> {
	return State.create({})
}
