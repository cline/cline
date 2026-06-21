import { EmptyRequest } from "@shared/proto/cline/common"
import { ClineRecommendedModelsResponse } from "@shared/proto/cline/models"
import type { Controller } from "../index"

export async function refreshClineRecommendedModelsRpc(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<ClineRecommendedModelsResponse> {
	return ClineRecommendedModelsResponse.create({})
}
