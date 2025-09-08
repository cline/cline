import { ModelInfo } from "@shared/api"

export function getMaxThinkingBudgetForModel(modelInfo: ModelInfo): number | undefined {
	// Prefer explicit thinkingConfig.maxBudget if available
	if (modelInfo.thinkingConfig?.maxBudget) {
		return modelInfo.thinkingConfig.maxBudget
	}

	// Fallback to maxTokens - 1 (as current buildApiHandler does)
	if (modelInfo.maxTokens) {
		return modelInfo.maxTokens - 1
	}

	return undefined
}

export function clampThinkingBudget(value: number, modelInfo: ModelInfo): number {
	const maxBudget = getMaxThinkingBudgetForModel(modelInfo)
	if (maxBudget !== undefined && value > maxBudget) {
		return maxBudget
	}
	return value
}
