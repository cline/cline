import { SubmitLimitIncreaseResponse } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function submitLimitIncreaseRequest(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<SubmitLimitIncreaseResponse> {
	return SubmitLimitIncreaseResponse.create({})
}
