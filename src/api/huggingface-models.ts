import {
	getHuggingFaceModels as fetchModels,
	getCachedRawHuggingFaceModels,
	type HuggingFaceModel,
} from "./providers/fetchers/huggingface"
import axios from "axios"
import { HUGGINGFACE_API_URL } from "@roo-code/types"

export interface HuggingFaceModelsResponse {
	models: HuggingFaceModel[]
	cached: boolean
	timestamp: number
}

export async function getHuggingFaceModels(): Promise<HuggingFaceModelsResponse> {
	try {
		// First, trigger the fetch to populate cache
		await fetchModels()

		// Get the raw models from cache
		const cachedRawModels = getCachedRawHuggingFaceModels()

		if (cachedRawModels) {
			return {
				models: cachedRawModels,
				cached: true,
				timestamp: Date.now(),
			}
		}

		// If no cached raw models, fetch directly from API
		const response = await axios.get(HUGGINGFACE_API_URL, {
			headers: {
				"Upgrade-Insecure-Requests": "1",
				"Sec-Fetch-Dest": "document",
				"Sec-Fetch-Mode": "navigate",
				"Sec-Fetch-Site": "none",
				"Sec-Fetch-User": "?1",
				Priority: "u=0, i",
				Pragma: "no-cache",
				"Cache-Control": "no-cache",
			},
			timeout: 10000,
		})

		const models = response.data?.data || []

		return {
			models,
			cached: false,
			timestamp: Date.now(),
		}
	} catch (error) {
		console.error("Failed to get HuggingFace models:", error)
		return {
			models: [],
			cached: false,
			timestamp: Date.now(),
		}
	}
}
