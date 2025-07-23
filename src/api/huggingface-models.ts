import { fetchHuggingFaceModels, type HuggingFaceModel } from "../services/huggingface-models"

export interface HuggingFaceModelsResponse {
	models: HuggingFaceModel[]
	cached: boolean
	timestamp: number
}

export async function getHuggingFaceModels(): Promise<HuggingFaceModelsResponse> {
	const models = await fetchHuggingFaceModels()

	return {
		models,
		cached: false, // We could enhance this to track if data came from cache
		timestamp: Date.now(),
	}
}
