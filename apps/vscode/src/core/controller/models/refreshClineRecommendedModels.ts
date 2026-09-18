import type { ClineRecommendedModelsData } from "@cline/core"
import { getModelProviderSettingsManager } from "@/sdk/model-provider-settings"

export type { ClineRecommendedModelsData } from "@cline/core"

export async function refreshClineRecommendedModels(): Promise<ClineRecommendedModelsData> {
	return (await getModelProviderSettingsManager()).getRecommendedModels()
}
