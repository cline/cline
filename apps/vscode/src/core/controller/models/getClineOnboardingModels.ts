import { featureFlagsService } from "@/services/feature-flags"
import type { ModelInfo } from "@/shared/api"
import type { OnboardingModel, OnboardingModelGroup } from "@/shared/proto/cline/state"
import type { Controller } from "../index"
import { refreshClineModels } from "./refreshClineModels"
import {
	type ClineRecommendedModelData,
	type ClineRecommendedModelsData,
	refreshClineRecommendedModels,
} from "./refreshClineRecommendedModels"

type OnboardingModelOverride = OnboardingModel & { hidden?: boolean }
type TimedOnboardingModelGroup = { models: OnboardingModelGroup; cachedAt: number }

const EMPTY_ONBOARDING_MODELS_CACHE_TTL_MS = 30 * 1000

let cached: OnboardingModelGroup | null = null
let emptyCached: TimedOnboardingModelGroup | null = null
let pendingRefresh: Promise<OnboardingModelGroup> | null = null
let cacheGeneration = 0

export function getCachedClineOnboardingModels(): OnboardingModelGroup | undefined {
	if (cached) {
		return cached
	}

	if (emptyCached && Date.now() - emptyCached.cachedAt <= EMPTY_ONBOARDING_MODELS_CACHE_TTL_MS) {
		return emptyCached.models
	}

	emptyCached = null
	return undefined
}

export async function getClineOnboardingModels(controller: Controller): Promise<OnboardingModelGroup> {
	const cachedModels = getCachedClineOnboardingModels()
	if (cachedModels) {
		return cachedModels
	}

	if (pendingRefresh) {
		return pendingRefresh
	}

	const refreshGeneration = cacheGeneration
	pendingRefresh = (async () => {
		try {
			const models = await fetchClineOnboardingModels(controller)
			if (refreshGeneration === cacheGeneration) {
				if (models.models.length > 0) {
					cached = models
					emptyCached = null
				} else {
					emptyCached = { models, cachedAt: Date.now() }
				}
			}
			return models
		} finally {
			if (refreshGeneration === cacheGeneration) {
				pendingRefresh = null
			}
		}
	})()

	return pendingRefresh
}

async function fetchClineOnboardingModels(controller: Controller): Promise<OnboardingModelGroup> {
	const [recommendedModels, modelCatalog] = await Promise.all([refreshClineRecommendedModels(), refreshClineModels(controller)])

	const models = toOnboardingModels(recommendedModels, modelCatalog)
	const remoteOverrides = featureFlagsService.getOnboardingOverrides()

	// Apply remote overrides if available
	if (remoteOverrides) {
		for (const [id, override] of Object.entries(remoteOverrides) as [string, OnboardingModelOverride][]) {
			if (override.hidden) {
				for (let i = models.length - 1; i >= 0; i--) {
					if (models[i].id === id) {
						models.splice(i, 1)
					}
				}
			} else {
				let found = false
				for (let i = 0; i < models.length; i++) {
					if (models[i].id === id) {
						models[i] = mergeModelWithOverride(models[i], override)
						found = true
					}
				}

				if (!found) {
					models.push(mergeModelWithOverride(undefined, override))
				}
			}
		}
	}

	return { models }
}

function toOnboardingModels(
	recommendedModels: ClineRecommendedModelsData,
	modelCatalog: Record<string, ModelInfo>,
): OnboardingModel[] {
	return [
		...recommendedModels.free.map((model) => toOnboardingModel(model, "free", "Free", modelCatalog)),
		...recommendedModels.recommended.map((model) => toOnboardingModel(model, "frontier", "", modelCatalog)),
	]
}

function toOnboardingModel(
	model: ClineRecommendedModelData,
	group: string,
	fallbackBadge: string,
	modelCatalog: Record<string, ModelInfo>,
): OnboardingModel {
	const catalogInfo = modelCatalog[model.id]
	const tag = model.tags[0] ?? ""
	const badge = tag || fallbackBadge

	return {
		id: model.id,
		name: model.name || model.id,
		group,
		badge,
		score: 0,
		latency: 0,
		info: catalogInfo
			? {
					contextWindow: catalogInfo.contextWindow ?? 0,
					supportsImages: catalogInfo.supportsImages ?? false,
					supportsPromptCache: catalogInfo.supportsPromptCache ?? false,
					inputPrice: catalogInfo.inputPrice ?? 0,
					outputPrice: catalogInfo.outputPrice ?? 0,
					tiers: catalogInfo.tiers ?? [],
				}
			: undefined,
	}
}

function mergeModelWithOverride(baseModel: OnboardingModel | undefined, override: OnboardingModelOverride): OnboardingModel {
	const baseInfo = baseModel?.info
	const overrideInfo = override.info

	// Merge info with proper defaults
	const mergedInfo = {
		...baseInfo,
		...overrideInfo,
		supportsPromptCache: overrideInfo?.supportsPromptCache ?? baseInfo?.supportsPromptCache ?? false,
		tiers: overrideInfo?.tiers ?? baseInfo?.tiers ?? [],
	}

	// Return merged model, using base as foundation if available
	return baseModel ? { ...baseModel, ...override, info: mergedInfo } : { ...override, info: mergedInfo }
}

export function clearOnboardingModelsCache(): void {
	cacheGeneration++
	cached = null
	emptyCached = null
	pendingRefresh = null
}
