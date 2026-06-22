import type { StringRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function authenticateMcpServer(_controller: Controller, _request: StringRequest): Promise<Empty> {
	return Empty.create({})
}
