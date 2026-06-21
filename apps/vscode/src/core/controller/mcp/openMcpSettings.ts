import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function openMcpSettings(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	return Empty.create({})
}
