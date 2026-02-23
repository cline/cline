/**
 * Featured models shown in the Cline model picker during onboarding
 * These are curated models that work well with Cline
 */
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@shared/cline/recommended-models"

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

export interface FeaturedModelsByTier {
	recommended: FeaturedModel[]
	free: FeaturedModel[]
}

interface RecommendedModelsByTier {
	recommended: RecommendedModelLike[]
	free: RecommendedModelLike[]
}

function toFeaturedModel(model: RecommendedModelLike): FeaturedModel {
	return {
		id: model.id,
		name: model.name,
		description: model.description,
		labels: model.tags,
	}
}

export const FEATURED_MODELS: FeaturedModelsByTier = {
	recommended: CLINE_RECOMMENDED_MODELS_FALLBACK.recommended.map(toFeaturedModel),
	free: CLINE_RECOMMENDED_MODELS_FALLBACK.free.map(toFeaturedModel),
}

export function getAllFeaturedModels(modelsByTier: FeaturedModelsByTier = FEATURED_MODELS): FeaturedModel[] {
	return [...modelsByTier.recommended, ...modelsByTier.free]
}

export function mapRecommendedModelsToFeaturedModels(data: RecommendedModelsByTier): FeaturedModelsByTier {
	return {
		recommended: data.recommended.map(toFeaturedModel),
		free: data.free.map(toFeaturedModel),
	}
}

export function withFeaturedModelFallback(modelsByTier: FeaturedModelsByTier): FeaturedModelsByTier {
	const recommended = modelsByTier.recommended.length > 0 ? modelsByTier.recommended : FEATURED_MODELS.recommended
	const free = modelsByTier.free.length > 0 ? modelsByTier.free : FEATURED_MODELS.free
	return { recommended, free }
}
