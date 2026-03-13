import { BytesRequest, Int64 } from "@shared/proto/cline/common"
import { Controller } from "../index"

export async function pingLatencyProbe(_controller: Controller, request: BytesRequest): Promise<Int64> {
	return Int64.create({ value: request.value?.length ?? 0 })
}
