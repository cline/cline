import type { EmptyRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function ocaAccountLogoutClicked(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	return Empty.create({})
}
