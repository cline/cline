import axios from "axios"
import { z } from "zod"

import { ApiHandlerOptions, ModelInfo } from "../../../shared/api"
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

export async function getOpenRouterModels(options?: ApiHandlerOptions) {
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

			// Disable prompt caching for Gemini models for now.
			const supportsPromptCache = !!cacheWritesPrice && !!cacheReadsPrice && !rawModel.id.startsWith("google")

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

			// Then OpenRouter model definition doesn't give us any hints about computer use,
			// so we need to set that manually.
			// The ideal `maxTokens` values are model dependent, but we should probably DRY
			// this up and use the values defined for the Anthropic providers.
			switch (true) {
				case rawModel.id.startsWith("anthropic/claude-3.7-sonnet"):
					modelInfo.supportsComputerUse = true
					modelInfo.maxTokens = rawModel.id === "anthropic/claude-3.7-sonnet:thinking" ? 128_000 : 8192
					break
				case rawModel.id.startsWith("anthropic/claude-3.5-sonnet-20240620"):
					modelInfo.maxTokens = 8192
					break
				case rawModel.id.startsWith("anthropic/claude-3.5-sonnet"):
					modelInfo.supportsComputerUse = true
					modelInfo.maxTokens = 8192
					break
				case rawModel.id.startsWith("anthropic/claude-3-5-haiku"):
				case rawModel.id.startsWith("anthropic/claude-3-opus"):
				case rawModel.id.startsWith("anthropic/claude-3-haiku"):
					modelInfo.maxTokens = 8192
					break
				default:
					break
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
