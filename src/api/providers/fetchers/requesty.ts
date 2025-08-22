import axios from "axios"

import type { ModelInfo } from "@roo-code/types"

import { parseApiPrice } from "../../../shared/cost"
import { toRequestyServiceUrl } from "../../../shared/utils/requesty"

export async function getRequestyModels(baseUrl?: string, apiKey?: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const resolvedBaseUrl = toRequestyServiceUrl(baseUrl)
		const modelsUrl = new URL("models", resolvedBaseUrl)

		const response = await axios.get(modelsUrl.toString(), { headers })
		const rawModels = response.data.data

		for (const rawModel of rawModels) {
			const reasoningBudget =
				rawModel.supports_reasoning &&
				(rawModel.id.includes("claude") ||
					rawModel.id.includes("coding/gemini-2.5") ||
					rawModel.id.includes("vertex/gemini-2.5"))
			const reasoningEffort =
				rawModel.supports_reasoning &&
				(rawModel.id.includes("openai") || rawModel.id.includes("google/gemini-2.5"))

			const modelInfo: ModelInfo = {
				maxTokens: rawModel.max_output_tokens,
				contextWindow: rawModel.context_window,
				supportsPromptCache: rawModel.supports_caching,
				supportsImages: rawModel.supports_vision,
				supportsComputerUse: rawModel.supports_computer_use,
				supportsReasoningBudget: reasoningBudget,
				supportsReasoningEffort: reasoningEffort,
				inputPrice: parseApiPrice(rawModel.input_price),
				outputPrice: parseApiPrice(rawModel.output_price),
				description: rawModel.description,
				cacheWritesPrice: parseApiPrice(rawModel.caching_price),
				cacheReadsPrice: parseApiPrice(rawModel.cached_price),
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(`Error fetching Requesty models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}
