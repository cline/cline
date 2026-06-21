import { SapAiCoreModelsRequest, SapAiCoreModelsResponse } from "@/shared/proto/cline/models"
import { Controller } from ".."

export async function getSapAiCoreModels(
	_controller: Controller,
	_request: SapAiCoreModelsRequest,
): Promise<SapAiCoreModelsResponse> {
	return SapAiCoreModelsResponse.create({})
}
