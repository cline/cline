import { EmptyRequest, Int64 } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function getTotalTasksSize(_controller: Controller, _request: EmptyRequest): Promise<Int64> {
	return Int64.create({})
}
