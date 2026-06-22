import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from "../index"

export async function openInBrowser(_controller: Controller, _request: StringRequest): Promise<Empty> {
	return Empty.create()
}
