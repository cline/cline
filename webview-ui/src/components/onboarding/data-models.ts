import type { OpenRouterModelInfo } from "@shared/proto/cline/models"
import type { OnboardingModel, OnboardingModelGroup } from "@shared/proto/cline/state"

export interface OnboardingModelsByGroup {
	free: ModelGroup[]
	power: ModelGroup[]
}

interface ModelGroup {
	group: string
	models: OnboardingModel[]
}

export function getClineUIOnboardingGroups(groupedModels: OnboardingModelGroup): OnboardingModelsByGroup {
	const { models } = groupedModels

	const freeModels = models.filter((m) => m.group === "free")
	const frontierModels = models.filter((m) => m.group === "frontier")
	const openSourceModels = models.filter((m) => m.group === "open source")

	return {
		free: freeModels.length > 0 ? [{ group: "free", models: freeModels }] : [],
		power: [
			...(frontierModels.length > 0 ? [{ group: "frontier", models: frontierModels }] : []),
			...(openSourceModels.length > 0 ? [{ group: "open source", models: openSourceModels }] : []),
		],
	}
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

export function getOverviewLabel(overview: number): string {
	if (overview >= 95) {
		return "Top Performer"
	}
	if (overview >= 80) {
		return "Great"
	}
	if (overview >= 60) {
		return "Good"
	}
	if (overview >= 50) {
		return "Average"
	}
	return "Below Average"
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
