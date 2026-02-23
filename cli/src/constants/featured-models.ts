/**
 * Featured models shown in the Cline model picker during onboarding
 * These are curated models that work well with Cline
 */
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@shared/cline/recommended-models"
import type { Controller } from "@/core/controller"
import { refreshClineRecommendedModels } from "@/core/controller/models/refreshClineRecommendedModels"

export interface FeaturedModel {
	id: string
	name: string
	description: string
	labels: string[]
}

type RecommendedModelLike = {
	id: string
	name: string
	description: string
	tags: string[]
}

function toFeaturedModel(model: RecommendedModelLike): FeaturedModel {
	return {
		id: model.id,
		name: model.name,
		description: model.description,
		labels: model.tags,
	}
}

export const FEATURED_MODELS: { recommended: FeaturedModel[]; free: FeaturedModel[] } = {
	recommended: CLINE_RECOMMENDED_MODELS_FALLBACK.recommended.map(toFeaturedModel),
	free: CLINE_RECOMMENDED_MODELS_FALLBACK.free.map(toFeaturedModel),
}

export function getAllFeaturedModels(): FeaturedModel[] {
	return [...FEATURED_MODELS.recommended, ...FEATURED_MODELS.free]
}

export async function getFeaturedModelsForCline(controller: Controller): Promise<{
	recommended: FeaturedModel[]
	free: FeaturedModel[]
}> {
	const data = await refreshClineRecommendedModels(controller)
	const recommended = data.recommended.length > 0 ? data.recommended.map(toFeaturedModel) : FEATURED_MODELS.recommended
	const free = data.free.length > 0 ? data.free.map(toFeaturedModel) : FEATURED_MODELS.free
	return { recommended, free }
}
