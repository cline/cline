import axios from "axios"
import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"
import { VERCEL_AI_GATEWAY_VISION_ONLY_MODELS, VERCEL_AI_GATEWAY_VISION_AND_TOOLS_MODELS } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"
import { parseApiPrice } from "../../../shared/cost"

/**
 * VercelAiGatewayPricing
 */

const vercelAiGatewayPricingSchema = z.object({
	input: z.string(),
	output: z.string(),
	input_cache_write: z.string().optional(),
	input_cache_read: z.string().optional(),
})

/**
 * VercelAiGatewayModel
 */

const vercelAiGatewayModelSchema = z.object({
	id: z.string(),
	object: z.string(),
	created: z.number(),
	owned_by: z.string(),
	name: z.string(),
	description: z.string(),
	context_window: z.number(),
	max_tokens: z.number(),
	type: z.string(),
	pricing: vercelAiGatewayPricingSchema,
})

export type VercelAiGatewayModel = z.infer<typeof vercelAiGatewayModelSchema>

/**
 * VercelAiGatewayModelsResponse
 */

const vercelAiGatewayModelsResponseSchema = z.object({
	object: z.string(),
	data: z.array(vercelAiGatewayModelSchema),
})

type VercelAiGatewayModelsResponse = z.infer<typeof vercelAiGatewayModelsResponseSchema>

/**
 * getVercelAiGatewayModels
 */

export async function getVercelAiGatewayModels(options?: ApiHandlerOptions): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = "https://ai-gateway.vercel.sh/v1"

	try {
		const response = await axios.get<VercelAiGatewayModelsResponse>(`${baseURL}/models`)
		const result = vercelAiGatewayModelsResponseSchema.safeParse(response.data)
		const data = result.success ? result.data.data : response.data.data

		if (!result.success) {
			console.error("Vercel AI Gateway models response is invalid", result.error.format())
		}

		for (const model of data) {
			const { id } = model

			// Only include language models for chat inference
			// Embedding models are statically defined in embeddingModels.ts
			if (model.type !== "language") {
				continue
			}

			models[id] = parseVercelAiGatewayModel({
				id,
				model,
			})
		}
	} catch (error) {
		console.error(
			`Error fetching Vercel AI Gateway models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
	}

	return models
}

/**
 * parseVercelAiGatewayModel
 */

export const parseVercelAiGatewayModel = ({ id, model }: { id: string; model: VercelAiGatewayModel }): ModelInfo => {
	const cacheWritesPrice = model.pricing?.input_cache_write
		? parseApiPrice(model.pricing?.input_cache_write)
		: undefined

	const cacheReadsPrice = model.pricing?.input_cache_read ? parseApiPrice(model.pricing?.input_cache_read) : undefined

	const supportsPromptCache = typeof cacheWritesPrice !== "undefined" && typeof cacheReadsPrice !== "undefined"
	const supportsImages =
		VERCEL_AI_GATEWAY_VISION_ONLY_MODELS.has(id) || VERCEL_AI_GATEWAY_VISION_AND_TOOLS_MODELS.has(id)
	const supportsComputerUse = VERCEL_AI_GATEWAY_VISION_AND_TOOLS_MODELS.has(id)

	const modelInfo: ModelInfo = {
		maxTokens: model.max_tokens,
		contextWindow: model.context_window,
		supportsImages,
		supportsComputerUse,
		supportsPromptCache,
		inputPrice: parseApiPrice(model.pricing?.input),
		outputPrice: parseApiPrice(model.pricing?.output),
		cacheWritesPrice,
		cacheReadsPrice,
		description: model.description,
	}

	return modelInfo
}
