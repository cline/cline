import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import axios from "axios"
import { Controller } from ".."

/**
 * Fetches available models from Aihubmix
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the Aihubmix models
 */
export async function getAihubmixModels(_controller: Controller, _request: EmptyRequest): Promise<OpenRouterCompatibleModelInfo> {
	try {
		const response = await axios.get("https://aihubmix.com/call/mdl_info")

		if (!response.data?.success || !Array.isArray(response.data?.data)) {
			console.error("Invalid response from Aihubmix API:", response.data)
			return OpenRouterCompatibleModelInfo.create({ models: {} })
		}

		// 按 order 字段排序，order 越大越靠前
		const sortedModels = response.data.data.sort((a: any, b: any) => (b.order || 0) - (a.order || 0))

		const models: Record<string, OpenRouterModelInfo> = {}

		for (const modelData of sortedModels) {
			if (!modelData.model || typeof modelData.model !== "string") {
				continue
			}

			const modelId = modelData.model
			const modelRatio = modelData.model_ratio || 1
			const completionRatio = modelData.completion_ratio || 1

			// 计算价格 (基于 model_ratio 和 completion_ratio)
			const inputPrice = modelRatio * 2 // 基础输入价格
			const outputPrice = inputPrice * completionRatio // 基础输出价格

			// 解析上下文长度
			const contextLength = modelData.context_length ? parseInt(modelData.context_length) : 128000

			// 检查是否支持图像
			const supportsImages =
				modelData.modalities?.includes("vision") ||
				modelData.modalities?.includes("image") ||
				modelData.features?.includes("vision") ||
				false

			// 检查是否支持音频
			const supportsAudio = modelData.modalities?.includes("audio") || false

			// 检查是否支持思维链
			const supportsThinking = modelData.features?.includes("thinking") || false

			// 检查是否支持缓存：cache_ratio 非1 就是支持缓存
			const supportsPromptCache = modelData.cache_ratio !== 1

			models[modelId] = OpenRouterModelInfo.create({
				maxTokens: modelData.max_output, // 限制最大 token 数
				contextWindow: contextLength,
				supportsImages: supportsImages,
				supportsPromptCache: supportsPromptCache,
				inputPrice: inputPrice,
				outputPrice: outputPrice,
				cacheWritesPrice: supportsPromptCache ? inputPrice * 0.25 : 0, // 缓存写入价格
				cacheReadsPrice: supportsPromptCache ? inputPrice * 0.025 : 0, // 缓存读取价格
				description: modelData.desc_en || modelData.desc || `Aihubmix ${modelId} model`,
				thinkingConfig: supportsThinking
					? {
							maxBudget: 1000000, // 1M tokens budget for thinking
							outputPrice: outputPrice * 2, // Thinking output costs more
							outputPriceTiers: [],
						}
					: undefined,
				supportsGlobalEndpoint: true,
				tiers: [],
			})
		}

		console.log(`Fetched ${Object.keys(models).length} Aihubmix models`)
		return OpenRouterCompatibleModelInfo.create({ models })
	} catch (error) {
		console.error("Failed to fetch Aihubmix models:", error)
		return OpenRouterCompatibleModelInfo.create({ models: {} })
	}
}
