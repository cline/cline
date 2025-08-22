import axios from "axios"
import { z } from "zod"
import { useQuery, UseQueryOptions } from "@tanstack/react-query"

import type { ModelInfo } from "@roo-code/types"

import { parseApiPrice } from "@roo/cost"

export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]"

const openRouterEndpointsSchema = z.object({
	data: z.object({
		id: z.string(),
		name: z.string(),
		description: z.string().optional(),
		architecture: z
			.object({
				modality: z.string().nullish(),
				tokenizer: z.string().nullish(),
			})
			.nullish(),
		endpoints: z.array(
			z.object({
				name: z.string(),
				tag: z.string().optional(),
				context_length: z.number(),
				max_completion_tokens: z.number().nullish(),
				pricing: z
					.object({
						prompt: z.union([z.string(), z.number()]).optional(),
						completion: z.union([z.string(), z.number()]).optional(),
						input_cache_read: z.union([z.string(), z.number()]).optional(),
						input_cache_write: z.union([z.string(), z.number()]).optional(),
					})
					.optional(),
			}),
		),
	}),
})

type OpenRouterModelProvider = ModelInfo & {
	label: string
}

async function getOpenRouterProvidersForModel(modelId: string) {
	const models: Record<string, OpenRouterModelProvider> = {}

	try {
		const response = await axios.get(`https://openrouter.ai/api/v1/models/${modelId}/endpoints`)
		const result = openRouterEndpointsSchema.safeParse(response.data)

		if (!result.success) {
			console.error("OpenRouter API response validation failed:", result.error)
			return models
		}

		const { description, architecture, endpoints } = result.data.data

		for (const endpoint of endpoints) {
			const providerName = endpoint.tag ?? endpoint.name
			const inputPrice = parseApiPrice(endpoint.pricing?.prompt)
			const outputPrice = parseApiPrice(endpoint.pricing?.completion)
			const cacheReadsPrice = parseApiPrice(endpoint.pricing?.input_cache_read)
			const cacheWritesPrice = parseApiPrice(endpoint.pricing?.input_cache_write)

			const modelInfo: OpenRouterModelProvider = {
				maxTokens: endpoint.max_completion_tokens || endpoint.context_length,
				contextWindow: endpoint.context_length,
				supportsImages: architecture?.modality?.includes("image"),
				supportsPromptCache: typeof cacheReadsPrice !== "undefined",
				cacheReadsPrice,
				cacheWritesPrice,
				inputPrice,
				outputPrice,
				description,
				label: providerName,
			}

			models[providerName] = modelInfo
		}
	} catch (error) {
		if (error instanceof z.ZodError) {
			console.error(`OpenRouter API response validation failed:`, error.errors)
		} else {
			console.error(`Error fetching OpenRouter providers:`, error)
		}
	}

	return models
}

type UseOpenRouterModelProvidersOptions = Omit<
	UseQueryOptions<Record<string, OpenRouterModelProvider>>,
	"queryKey" | "queryFn"
>

export const useOpenRouterModelProviders = (modelId?: string, options?: UseOpenRouterModelProvidersOptions) =>
	useQuery<Record<string, OpenRouterModelProvider>>({
		queryKey: ["openrouter-model-providers", modelId],
		queryFn: () => (modelId ? getOpenRouterProvidersForModel(modelId) : {}),
		...options,
	})
