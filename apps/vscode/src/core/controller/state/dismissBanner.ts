import type { StringRequest } from "@/shared/proto/cline/common"
import { Empty } from "@/shared/proto/cline/common"
import type { Controller } from ".."

export async function dismissBanner(_controller: Controller, _request: StringRequest): Promise<Empty> {
	return Empty.create({})
}
