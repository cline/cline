import { featureFlagsService } from "@/services/feature-flags"
import { CLINE_ONBOARDING_MODELS } from "@/shared/cline/onboarding"
import { OnboardingModel, OnboardingModelGroup } from "@/shared/proto/cline/state"

type OnboardingModelOverride = OnboardingModel & { hidden?: boolean }

let cached: OnboardingModelGroup | null = null

export function getClineOnboardingModels(): OnboardingModelGroup {
	if (cached) {
		return cached
	}

	const remoteOverrides = featureFlagsService.getOnboardingOverrides()
	const models = [...CLINE_ONBOARDING_MODELS]

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

	cached = { models }
	return cached
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
	cached = null
}
