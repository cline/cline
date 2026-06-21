interface ClineRecommendedModelData {
	id: string
	name: string
	description: string
	tags: string[]
}

export interface ClineRecommendedModelsData {
	recommended: ClineRecommendedModelData[]
	free: ClineRecommendedModelData[]
	clinePass?: ClineRecommendedModelData[]
}

export async function refreshClineRecommendedModels(): Promise<ClineRecommendedModelsData> {
	return { recommended: [], free: [] }
}

export function resetClineRecommendedModelsCacheForTests(): void {
	return
}
