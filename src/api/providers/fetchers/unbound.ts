import axios from "axios"

import { ModelInfo } from "../../../shared/api"

export async function getUnboundModels(apiKey?: string | null): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const response = await axios.get("https://api.getunbound.ai/models", { headers })

		if (response.data) {
			const rawModels: Record<string, any> = response.data

			for (const [modelId, model] of Object.entries(rawModels)) {
				const modelInfo: ModelInfo = {
					maxTokens: model?.maxTokens ? parseInt(model.maxTokens) : undefined,
					contextWindow: model?.contextWindow ? parseInt(model.contextWindow) : 0,
					supportsImages: model?.supportsImages ?? false,
					supportsPromptCache: model?.supportsPromptCaching ?? false,
					supportsComputerUse: model?.supportsComputerUse ?? false,
					inputPrice: model?.inputTokenPrice ? parseFloat(model.inputTokenPrice) : undefined,
					outputPrice: model?.outputTokenPrice ? parseFloat(model.outputTokenPrice) : undefined,
					cacheWritesPrice: model?.cacheWritePrice ? parseFloat(model.cacheWritePrice) : undefined,
					cacheReadsPrice: model?.cacheReadPrice ? parseFloat(model.cacheReadPrice) : undefined,
				}

				switch (true) {
					case modelId.startsWith("anthropic/"):
						// Set max tokens to 8192 for supported Anthropic models
						if (modelInfo.maxTokens !== 4096) {
							modelInfo.maxTokens = 8192
						}
						break
					default:
						break
				}

				models[modelId] = modelInfo
			}
		}
	} catch (error) {
		console.error(`Error fetching Unbound models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
		throw new Error(`Failed to fetch Unbound models: ${error instanceof Error ? error.message : "Unknown error"}`)
	}

	return models
}
