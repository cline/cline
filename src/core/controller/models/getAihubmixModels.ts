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
		const response = await axios.get("https://aihubmix.com/call/mdl_info_platform?tag=coding", getAxiosSettings())

		if (!response.data?.success || !Array.isArray(response.data?.data)) {
			console.error("Invalid response from AIhubmix API:", response.data)
			return OpenRouterCompatibleModelInfo.create({ models: {} })
		}
		// 原始数据为数组，不能直接复用为 map；需构造独立的 modelsMap
		const modelsArray = response.data.data as any[]
		const modelsMap: Record<string, OpenRouterModelInfo> = {}

		for (const modelData of modelsArray) {
			if (!modelData.model || typeof modelData.model !== "string") {
				continue
			}

			// 检查是否支持图像
			const supportsImages =
				modelData.modalities?.includes("vision") ||
				modelData.modalities?.includes("image") ||
				modelData.features?.includes("vision") ||
				false

			// 检查是否支持思维链
			const supportsThinking = modelData.features?.includes("thinking") || false

			// 检查是否支持缓存：cache_ratio 非1 或 读价与输入价不同
			const pricing = modelData.pricing || {}
			const supportsPromptCache =
				(modelData.cache_ratio !== undefined && modelData.cache_ratio !== 1) ||
				(pricing.cache_read !== undefined && pricing.input !== undefined && pricing.cache_read !== pricing.input)

			const modelId = modelData.model
			modelsMap[modelId] = OpenRouterModelInfo.create({
				maxTokens: modelData.max_output ?? 8192,
				contextWindow: modelData.context_window ?? 128000,
				supportsImages: supportsImages,
				supportsPromptCache: supportsPromptCache,
				inputPrice: pricing.input ?? 0,
				outputPrice: pricing.output ?? 0,
				cacheWritesPrice: pricing.cache_write ?? 0,
				cacheReadsPrice: pricing.cache_read ?? 0,
				description: modelData.desc_en || modelData.desc || "",
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
