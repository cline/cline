import axios from "axios"
import { z } from "zod"

import { ApiHandlerOptions, ModelInfo, anthropicModels, COMPUTER_USE_MODELS } from "../../../shared/api"
import { parseApiPrice } from "../../../utils/cost"

/**
 * OpenRouterBaseModel
 */

const openRouterArchitectureSchema = z.object({
	modality: z.string().nullish(),
	tokenizer: z.string().nullish(),
})

const openRouterPricingSchema = z.object({
	prompt: z.string().nullish(),
	completion: z.string().nullish(),
	input_cache_write: z.string().nullish(),
	input_cache_read: z.string().nullish(),
})

const modelRouterBaseModelSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	context_length: z.number(),
	max_completion_tokens: z.number().nullish(),
	pricing: openRouterPricingSchema.optional(),
})

export type OpenRouterBaseModel = z.infer<typeof modelRouterBaseModelSchema>

/**
 * OpenRouterModel
 */

export const openRouterModelSchema = modelRouterBaseModelSchema.extend({
	id: z.string(),
	architecture: openRouterArchitectureSchema.optional(),
	top_provider: z.object({ max_completion_tokens: z.number().nullish() }).optional(),
})

export type OpenRouterModel = z.infer<typeof openRouterModelSchema>

/**
 * OpenRouterModelEndpoint
 */

export const openRouterModelEndpointSchema = modelRouterBaseModelSchema.extend({
	provider_name: z.string(),
})

export type OpenRouterModelEndpoint = z.infer<typeof openRouterModelEndpointSchema>

/**
 * OpenRouterModelsResponse
 */

const openRouterModelsResponseSchema = z.object({
	data: z.array(openRouterModelSchema),
})

type OpenRouterModelsResponse = z.infer<typeof openRouterModelsResponseSchema>

/**
 * OpenRouterModelEndpointsResponse
 */

const openRouterModelEndpointsResponseSchema = z.object({
	data: z.object({
		id: z.string(),
		name: z.string(),
		description: z.string().optional(),
		architecture: openRouterArchitectureSchema.optional(),
		endpoints: z.array(openRouterModelEndpointSchema),
	}),
})

type OpenRouterModelEndpointsResponse = z.infer<typeof openRouterModelEndpointsResponseSchema>

/**
 * getOpenRouterModels
 */

export async function getOpenRouterModels(options?: ApiHandlerOptions): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = options?.openRouterBaseUrl || "https://openrouter.ai/api/v1"

	try {
		const response = await axios.get<OpenRouterModelsResponse>(`${baseURL}/models`)
		const result = openRouterModelsResponseSchema.safeParse(response.data)
		const data = result.success ? result.data.data : response.data.data

		if (!result.success) {
			console.error("OpenRouter models response is invalid", result.error.format())
		}

		for (const model of data) {
			const { id, architecture, top_provider } = model

			models[id] = parseOpenRouterModel({
				id,
				model,
				modality: architecture?.modality,
				maxTokens: id.startsWith("anthropic/") ? top_provider?.max_completion_tokens : 0,
			})
		}
	} catch (error) {
		console.error(
			`Error fetching OpenRouter models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
	}

	return models
}

/**
 * getOpenRouterModelEndpoints
 */

export async function getOpenRouterModelEndpoints(
	modelId: string,
	options?: ApiHandlerOptions,
): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = options?.openRouterBaseUrl || "https://openrouter.ai/api/v1"

	try {
		const response = await axios.get<OpenRouterModelEndpointsResponse>(`${baseURL}/models/${modelId}/endpoints`)
		const result = openRouterModelEndpointsResponseSchema.safeParse(response.data)
		const data = result.success ? result.data.data : response.data.data

		if (!result.success) {
			console.error("OpenRouter model endpoints response is invalid", result.error.format())
		}

		const { id, architecture, endpoints } = data

		for (const endpoint of endpoints) {
			models[endpoint.provider_name] = parseOpenRouterModel({
				id,
				model: endpoint,
				modality: architecture?.modality,
				maxTokens: id.startsWith("anthropic/") ? endpoint.max_completion_tokens : 0,
			})
		}
	} catch (error) {
		console.error(
			`Error fetching OpenRouter model endpoints: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
	}

	return models
}

/**
 * parseOpenRouterModel
 */

export const parseOpenRouterModel = ({
	id,
	model,
	modality,
	maxTokens,
}: {
	id: string
	model: OpenRouterBaseModel
	modality: string | null | undefined
	maxTokens: number | null | undefined
}): ModelInfo => {
	const cacheWritesPrice = model.pricing?.input_cache_write
		? parseApiPrice(model.pricing?.input_cache_write)
		: undefined

	const cacheReadsPrice = model.pricing?.input_cache_read ? parseApiPrice(model.pricing?.input_cache_read) : undefined

	const supportsPromptCache = typeof cacheWritesPrice !== "undefined" && typeof cacheReadsPrice !== "undefined"

	const modelInfo: ModelInfo = {
		maxTokens: maxTokens || 0,
		contextWindow: model.context_length,
		supportsImages: modality?.includes("image") ?? false,
		supportsPromptCache,
		inputPrice: parseApiPrice(model.pricing?.prompt),
		outputPrice: parseApiPrice(model.pricing?.completion),
		cacheWritesPrice,
		cacheReadsPrice,
		description: model.description,
		thinking: id === "anthropic/claude-3.7-sonnet:thinking",
	}

	// The OpenRouter model definition doesn't give us any hints about
	// computer use, so we need to set that manually.
	if (COMPUTER_USE_MODELS.has(id)) {
		modelInfo.supportsComputerUse = true
	}

	// Claude 3.7 Sonnet is a "hybrid" thinking model, and the `maxTokens`
	// values can be configured. For the non-thinking variant we want to
	// use 8k. The `thinking` variant can be run in 64k and 128k modes,
	// and we want to use 128k.
	if (id.startsWith("anthropic/claude-3.7-sonnet")) {
		modelInfo.maxTokens = id.includes("thinking")
			? anthropicModels["claude-3-7-sonnet-20250219:thinking"].maxTokens
			: anthropicModels["claude-3-7-sonnet-20250219"].maxTokens
	}

	return modelInfo
}
