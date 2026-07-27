import type { ClineRecommendedModel, OpenRouterModelInfo } from "@shared/proto/cline/models"
import type { OnboardingModel, OnboardingModelGroup } from "@shared/proto/cline/state"

export const CLINEPASS_GROUP = "cline-pass"

export interface RecommendedModelsData {
	recommended: ClineRecommendedModel[]
	free: ClineRecommendedModel[]
	clinePass: ClineRecommendedModel[]
}

type RecommendedModelsResponseLike = {
	recommended?: ClineRecommendedModel[]
	free?: ClineRecommendedModel[]
	clinePass?: ClineRecommendedModel[]
}

export function getRecommendedModelsData(response: RecommendedModelsResponseLike): RecommendedModelsData | undefined {
	const recommended = response.recommended ?? []
	const free = response.free ?? []
	const clinePass = response.clinePass ?? []

	if (recommended.length === 0 && free.length === 0 && clinePass.length === 0) {
		return undefined
	}

	return { recommended, free, clinePass }
}

export interface OnboardingModelsByGroup {
	clinePass: ModelGroup[]
	free: ModelGroup[]
	power: ModelGroup[]
}

interface ModelGroup {
	group: string
	models: OnboardingModel[]
}

function isClinePassOnboardingModel(model: OnboardingModel): boolean {
	return model.group === CLINEPASS_GROUP
}

export function getClineUIOnboardingGroups(groupedModels: OnboardingModelGroup): OnboardingModelsByGroup {
	const { models } = groupedModels

	const clinePassModels = models.filter(isClinePassOnboardingModel)
	const freeModels = models.filter((m) => m.group === "free")
	const frontierModels = models.filter((m) => m.group === "frontier")
	const openSourceModels = models.filter((m) => m.group === "open source")

	return {
		clinePass: clinePassModels.length > 0 ? [{ group: CLINEPASS_GROUP, models: clinePassModels }] : [],
		free: freeModels.length > 0 ? [{ group: "free", models: freeModels }] : [],
		power: [
			...(frontierModels.length > 0 ? [{ group: "frontier", models: frontierModels }] : []),
			...(openSourceModels.length > 0 ? [{ group: "open source", models: openSourceModels }] : []),
		],
	}
}

export function getOnboardingGroupDisplayName(group: string): string {
	if (group === CLINEPASS_GROUP) {
		return "ClinePass"
	}
	return group
}

export function getPriceRange(modelInfo: OpenRouterModelInfo): string {
	const prompt = Number(modelInfo.inputPrice ?? 0)
	const completion = Number(modelInfo.outputPrice ?? 0)
	const cost = prompt + completion
	if (cost === 0) {
		return "Free"
	}
	if (cost < 10) {
		return "$"
	}
	if (cost > 50) {
		return "$$$"
	}
	return "$$"
}

export function getCapabilities(modelInfo: OpenRouterModelInfo): string[] {
	const capabilities = new Set<string>()
	if (modelInfo.supportsImages) {
		capabilities.add("Images")
	}
	if (modelInfo.supportsPromptCache) {
		capabilities.add("Prompt Cache")
	}
	capabilities.add("Tools")
	return Array.from(capabilities)
}

export function getSpeedLabel(latency?: number): string {
	if (!latency) {
		return "Average"
	}
	if (latency < 1) {
		return "Instant"
	}
	if (latency < 2) {
		return "Fast"
	}
	if (latency > 5) {
		return "Slow"
	}

	return "Average"
}
