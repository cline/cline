import axios from "axios"
import { z } from "zod"

import { type ModelInfo, IO_INTELLIGENCE_CACHE_DURATION } from "@roo-code/types"

import type { ModelRecord } from "../../../shared/api"

const ioIntelligenceModelSchema = z.object({
	id: z.string(),
	object: z.literal("model"),
	created: z.number(),
	owned_by: z.string(),
	root: z.string().nullable().optional(),
	parent: z.string().nullable().optional(),
	max_model_len: z.number().nullable().optional(),
	permission: z.array(
		z.object({
			id: z.string(),
			object: z.literal("model_permission"),
			created: z.number(),
			allow_create_engine: z.boolean(),
			allow_sampling: z.boolean(),
			allow_logprobs: z.boolean(),
			allow_search_indices: z.boolean(),
			allow_view: z.boolean(),
			allow_fine_tuning: z.boolean(),
			organization: z.string(),
			group: z.string().nullable(),
			is_blocking: z.boolean(),
		}),
	),
})

export type IOIntelligenceModel = z.infer<typeof ioIntelligenceModelSchema>

const ioIntelligenceApiResponseSchema = z.object({
	object: z.literal("list"),
	data: z.array(ioIntelligenceModelSchema),
})

type IOIntelligenceApiResponse = z.infer<typeof ioIntelligenceApiResponseSchema>

interface CacheEntry {
	data: ModelRecord
	timestamp: number
}

let cache: CacheEntry | null = null

/**
 * Model context length mapping based on the documentation
 * <mcreference link="https://docs.io.net/reference/get-started-with-io-intelligence-api" index="1">1</mcreference>
 */
const MODEL_CONTEXT_LENGTHS: Record<string, number> = {
	"meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": 430000,
	"deepseek-ai/DeepSeek-R1-0528": 128000,
	"Intel/Qwen3-Coder-480B-A35B-Instruct-int4-mixed-ar": 106000,
	"openai/gpt-oss-120b": 131072,
}

const VISION_MODELS = new Set([
	"Qwen/Qwen2.5-VL-32B-Instruct",
	"meta-llama/Llama-3.2-90B-Vision-Instruct",
	"meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
])

function parseIOIntelligenceModel(model: IOIntelligenceModel): ModelInfo {
	const contextLength = MODEL_CONTEXT_LENGTHS[model.id] || 8192
	// Cap maxTokens at 32k for very large context windows, or 20% of context length, whichever is smaller.
	const maxTokens = Math.min(contextLength, Math.ceil(contextLength * 0.2), 32768)
	const supportsImages = VISION_MODELS.has(model.id)

	return {
		maxTokens,
		contextWindow: contextLength,
		supportsImages,
		supportsPromptCache: false,
		supportsComputerUse: false,
		description: `${model.id} via IO Intelligence`,
	}
}

/**
 * Fetches available models from IO Intelligence
 * <mcreference link="https://docs.io.net/reference/get-started-with-io-intelligence-api" index="1">1</mcreference>
 */
export async function getIOIntelligenceModels(apiKey?: string): Promise<ModelRecord> {
	const now = Date.now()

	if (cache && now - cache.timestamp < IO_INTELLIGENCE_CACHE_DURATION) {
		return cache.data
	}

	const models: ModelRecord = {}

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		}

		if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`
		} else {
			console.error("IO Intelligence API key is required")
			throw new Error("IO Intelligence API key is required")
		}

		const response = await axios.get<IOIntelligenceApiResponse>(
			"https://api.intelligence.io.solutions/api/v1/models",
			{
				headers,
				timeout: 10_000,
			},
		)

		const result = ioIntelligenceApiResponseSchema.safeParse(response.data)

		if (!result.success) {
			console.error("IO Intelligence models response validation failed:", result.error.format())
			throw new Error("Invalid response format from IO Intelligence API")
		}

		for (const model of result.data.data) {
			models[model.id] = parseIOIntelligenceModel(model)
		}

		cache = { data: models, timestamp: now }

		return models
	} catch (error) {
		console.error("Error fetching IO Intelligence models:", error)

		if (cache) {
			return cache.data
		}

		if (axios.isAxiosError(error)) {
			if (error.response) {
				throw new Error(
					`Failed to fetch IO Intelligence models: ${error.response.status} ${error.response.statusText}`,
				)
			} else if (error.request) {
				throw new Error(
					"Failed to fetch IO Intelligence models: No response from server. Check your internet connection.",
				)
			}
		}

		throw new Error(
			`Failed to fetch IO Intelligence models: ${error instanceof Error ? error.message : "Unknown error"}`,
		)
	}
}

export function getCachedIOIntelligenceModels(): ModelRecord | null {
	return cache?.data || null
}

export function clearIOIntelligenceCache(): void {
	cache = null
}
