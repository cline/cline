import axios from "axios"
import { z } from "zod"

import {
	ApiHandlerOptions,
	ModelInfo,
	anthropicModels,
	COMPUTER_USE_MODELS,
	OPTIONAL_PROMPT_CACHING_MODELS,
} from "../../../shared/api"
import { parseApiPrice } from "../../../utils/cost"

// https://openrouter.ai/api/v1/models
export const openRouterModelSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	context_length: z.number(),
	max_completion_tokens: z.number().nullish(),
	architecture: z
		.object({
			modality: z.string().nullish(),
			tokenizer: z.string().nullish(),
		})
		.optional(),
	pricing: z
		.object({
			prompt: z.string().nullish(),
			completion: z.string().nullish(),
			input_cache_write: z.string().nullish(),
			input_cache_read: z.string().nullish(),
		})
		.optional(),
	top_provider: z
		.object({
			max_completion_tokens: z.number().nullish(),
		})
		.optional(),
})

export type OpenRouterModel = z.infer<typeof openRouterModelSchema>

const openRouterModelsResponseSchema = z.object({
	data: z.array(openRouterModelSchema),
})

type OpenRouterModelsResponse = z.infer<typeof openRouterModelsResponseSchema>

export async function getOpenRouterModels(options?: ApiHandlerOptions): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = options?.openRouterBaseUrl || "https://openrouter.ai/api/v1"

	try {
		const response = await axios.get<OpenRouterModelsResponse>(`${baseURL}/models`)
		const result = openRouterModelsResponseSchema.safeParse(response.data)
		const rawModels = result.success ? result.data.data : response.data.data

		if (!result.success) {
			console.error("OpenRouter models response is invalid", result.error.format())
		}

		for (const rawModel of rawModels) {
			const cacheWritesPrice = rawModel.pricing?.input_cache_write
				? parseApiPrice(rawModel.pricing?.input_cache_write)
				: undefined

			const cacheReadsPrice = rawModel.pricing?.input_cache_read
				? parseApiPrice(rawModel.pricing?.input_cache_read)
				: undefined

			const supportsPromptCache =
				typeof cacheWritesPrice !== "undefined" && typeof cacheReadsPrice !== "undefined"

			const modelInfo: ModelInfo = {
				maxTokens: rawModel.top_provider?.max_completion_tokens,
				contextWindow: rawModel.context_length,
				supportsImages: rawModel.architecture?.modality?.includes("image"),
				supportsPromptCache,
				inputPrice: parseApiPrice(rawModel.pricing?.prompt),
				outputPrice: parseApiPrice(rawModel.pricing?.completion),
				cacheWritesPrice,
				cacheReadsPrice,
				description: rawModel.description,
				thinking: rawModel.id === "anthropic/claude-3.7-sonnet:thinking",
			}

			// The OpenRouter model definition doesn't give us any hints about
			// computer use, so we need to set that manually.
			if (COMPUTER_USE_MODELS.has(rawModel.id)) {
				modelInfo.supportsComputerUse = true
			}

			// We want to treat prompt caching as "experimental" for these models.
			if (OPTIONAL_PROMPT_CACHING_MODELS.has(rawModel.id)) {
				modelInfo.isPromptCacheOptional = true
			}

			// Claude 3.7 Sonnet is a "hybrid" thinking model, and the `maxTokens`
			// values can be configured. For the non-thinking variant we want to
			// use 8k. The `thinking` variant can be run in 64k and 128k modes,
			// and we want to use 128k.
			if (rawModel.id.startsWith("anthropic/claude-3.7-sonnet")) {
				modelInfo.maxTokens = rawModel.id.includes("thinking")
					? anthropicModels["claude-3-7-sonnet-20250219:thinking"].maxTokens
					: anthropicModels["claude-3-7-sonnet-20250219"].maxTokens
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(
			`Error fetching OpenRouter models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
	}

	return models
}
