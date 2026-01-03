import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * Fetches available models from AIhubmix
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the AIhubmix models
 */
export async function getAihubmixModels(_controller: Controller, _request: EmptyRequest): Promise<OpenRouterCompatibleModelInfo> {
	try {
		const response = await axios.get("https://aihubmix.com/api/v1/models?type=llm&sort_by=coding", { ...getAxiosSettings() })

		if (!response.data?.success || !Array.isArray(response.data?.data)) {
			console.error("Invalid response from AIhubmix API:", response.data)
			return OpenRouterCompatibleModelInfo.create({ models: {} })
		}
		// Original data is an array, need to construct a separate modelsMap
		const modelsArray = response.data.data as any[]
		const modelsMap: Record<string, OpenRouterModelInfo> = {}

		for (const modelData of modelsArray) {
			if (!modelData.model_id || typeof modelData.model_id !== "string") {
				continue
			}

			// Parse features and input_modalities from comma-separated strings
			const features = modelData.features
				? typeof modelData.features === "string"
					? modelData.features.split(",").map((f: string) => f.trim())
					: Array.isArray(modelData.features)
						? modelData.features
						: []
				: []
			const inputModalities = modelData.input_modalities
				? typeof modelData.input_modalities === "string"
					? modelData.input_modalities.split(",").map((m: string) => m.trim())
					: Array.isArray(modelData.input_modalities)
						? modelData.input_modalities
						: []
				: []

			// Check if model supports images
			const supportsImages = inputModalities.includes("image") || false

			// Check if model supports thinking
			const supportsThinking = features.includes("thinking") || false

			// Check if model supports prompt cache: cache_ratio !== 1 or cache_read price differs from input price
			const pricing = modelData.pricing || {}
			const supportsPromptCache =
				pricing.cache_read !== undefined && pricing.input !== undefined && pricing.cache_read !== pricing.input

			const modelId = modelData.model_id
			modelsMap[modelId] = OpenRouterModelInfo.create({
				maxTokens: modelData.max_output ?? 8192,
				contextWindow: modelData.context_length ?? 128000,
				supportsImages: supportsImages,
				supportsPromptCache: supportsPromptCache,
				inputPrice: pricing.input ?? 0,
				outputPrice: pricing.output ?? 0,
				cacheWritesPrice: pricing.cache_write ?? 0,
				cacheReadsPrice: pricing.cache_read ?? 0,
				description: modelData.desc || "",
				thinkingConfig: supportsThinking
					? modelData.thinking_config
						? modelData.thinking_config
						: undefined
					: undefined,
				supportsGlobalEndpoint: modelData.supports_global_endpoint ?? undefined,
				tiers: [],
			})
		}

		console.log(`Fetched ${Object.keys(modelsMap).length} AIhubmix models`)
		return OpenRouterCompatibleModelInfo.create({ models: modelsMap })
	} catch (error) {
		console.error("Failed to fetch AIhubmix models:", error)
		return OpenRouterCompatibleModelInfo.create({ models: {} })
	}
}
