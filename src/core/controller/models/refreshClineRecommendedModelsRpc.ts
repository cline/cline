import { EmptyRequest } from "@shared/proto/cline/common"
import { ClineRecommendedModel, ClineRecommendedModelsResponse } from "@shared/proto/cline/models"
import type { Controller } from "../index"
import { refreshClineRecommendedModels } from "./refreshClineRecommendedModels"

export async function refreshClineRecommendedModelsRpc(
	controller: Controller,
	_request: EmptyRequest,
): Promise<ClineRecommendedModelsResponse> {
	const models = await refreshClineRecommendedModels(controller)
	return ClineRecommendedModelsResponse.create({
		recommended: models.recommended.map((model) =>
			ClineRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
		free: models.free.map((model) =>
			ClineRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
	})
}
