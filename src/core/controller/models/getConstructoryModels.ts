import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * Fetches available models from Constructory
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the Constructory models
 */
export async function getConstructoryModels(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	try {
		const baseURL = process.env.RESEARCH_API_SERVER ?? "https://stage-constructor.dev"
		const sessionToken = process.env.RESEARCH_SDK_TOKEN ?? "KL5ISS6O2R7B0SP9HU1CECUVZ5GMY746"

		if (!baseURL || !sessionToken) {
			console.error("RESEARCH_API_SERVER or RESEARCH_SDK_TOKEN not configured")
			return OpenRouterCompatibleModelInfo.create({ models: {} })
		}

		const modelsEndpoint = `${baseURL}/api/platform-kmapi/v1/language_models?mode=openai`

		const response = await axios.get(modelsEndpoint, {
			headers: {
				"X-CTR-Session-Token": sessionToken,
			},
			...getAxiosSettings(),
		})

		console.log(`[DEBUG] Constructory models qury path: ${modelsEndpoint}`, process)

		if (!response.data || !Array.isArray(response.data.data)) {
			console.error("Invalid response from Constructory API:", response.data)
			return OpenRouterCompatibleModelInfo.create({ models: {} })
		}

		const modelsMap: Record<string, OpenRouterModelInfo> = {}

		for (const modelData of response.data.data) {
			const modelId = modelData.id || modelData.model || modelData.name
			if (!modelId || typeof modelId !== "string") {
				continue
			}

			modelsMap[modelId] = OpenRouterModelInfo.create({
				maxTokens: modelData.max_tokens || modelData.maxTokens || 8192,
				contextWindow: modelData.context_window || modelData.contextWindow || 128000,
				supportsImages: modelData.supports_images || modelData.supportsImages || false,
				supportsPromptCache: modelData.supports_prompt_cache || modelData.supportsPromptCache || false,
				inputPrice: modelData.input_price || modelData.inputPrice || 0,
				outputPrice: modelData.output_price || modelData.outputPrice || 0,
				cacheWritesPrice: modelData.cache_writes_price || modelData.cacheWritesPrice || 0,
				cacheReadsPrice: modelData.cache_reads_price || modelData.cacheReadsPrice || 0,
				description: modelData.description || "",
				tiers: [],
			})
		}

		console.log(`Fetched ${Object.keys(modelsMap).length} Constructory models`)

		return OpenRouterCompatibleModelInfo.create({ models: modelsMap })
	} catch (error) {
		console.error("Failed to fetch Constructory models:", error)
		return OpenRouterCompatibleModelInfo.create({ models: {} })
	}
}
